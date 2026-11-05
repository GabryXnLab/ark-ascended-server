// Rotte HTTP dell'agent.

import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "./config.js";
import { getMetrics } from "./metrics.js";
import { arkStatus, saveWorldAndSettle, startArk, stopArk } from "./ark.js";
import {
  listProfiles,
  saveProfile,
  getProfile,
  deleteProfile,
} from "./maps.js";
import { migrateLegacyKeyLocations } from "./shared/config-rules.js";
import { getWatcherState, setIdleStopMinutes } from "./watcher.js";
import { closeAllLive, getClosedSessions, getLiveSessions } from "./playtime.js";
import { listInstalledMods, uninstallMod } from "./mods-library.js";
import { backupSaves, readLastBackup } from "./backup.js";
import { restoreSave } from "./restore.js";
import { assertValidObjectKey } from "./backup-store.js";
import { cancelProvisioning, ensureProvisioned, getProvisionState, type ProvisionSettings } from "./provision.js";
import {
  formatAdminWhitelistText,
  normalizeAdminAccountIds,
  readAdminWhitelist,
  replaceAdminWhitelist,
} from "./admin-whitelist.js";

// Avvolge un handler async inoltrando gli errori a Express.
function h(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now(), revision: config.imageRevision }));

// ASA interroga questa risorsa da 127.0.0.1 tramite AdminListURL. Il middleware
// principale la rende anonima soltanto sul loopback del container; dalla VCN
// continua a essere necessario AGENT_TOKEN come per ogni altra rotta.
router.get("/admin-whitelist.txt", h(async (_req, res) => {
  const accountIds = await readAdminWhitelist();
  res.set("Cache-Control", "no-store");
  res.type("text/plain").send(formatAdminWhitelistText(accountIds));
}));

router.get("/metrics", h(async (_req, res) => {
  res.json(await getMetrics());
}));

router.get("/ark/status", h(async (_req, res) => {
  res.json(await arkStatus());
}));

router.get("/admin-whitelist", h(async (_req, res) => {
  res.json({ accountIds: await readAdminWhitelist() });
}));

router.put("/admin-whitelist", h(async (req, res) => {
  let accountIds: string[];
  try {
    accountIds = normalizeAdminAccountIds(req.body?.accountIds);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "accountIds non validi" });
  }
  res.json({ accountIds: await replaceAdminWhitelist(accountIds) });
}));

router.post("/ark/start", h(async (req, res) => {
  const map = typeof req.body?.map === "string" ? req.body.map : undefined;
  const id = typeof req.body?.id === "string" ? req.body.id : undefined;
  res.json(await startArk(map, id));
}));

// Usata solo dallo spegnimento del control plane: annulla anche il provisioning,
// che altrimenti potrebbe riavviare ASA subito dopo lo stop.
router.post("/ark/stop", h(async (_req, res) => {
  cancelProvisioning();
  await closeAllLive();
  await stopArk();
  res.json({ ok: true });
}));

router.get("/maps", h(async (_req, res) => {
  res.json(await listProfiles());
}));

router.post("/map/install", h(async (req, res) => {
  const { id, name, map, mods, consoleCompatible } = req.body ?? {};
  if (typeof id !== "string" || typeof map !== "string") {
    return res.status(400).json({ error: "'id' e 'map' richiesti" });
  }
  await saveProfile({
    id,
    name: typeof name === "string" ? name : id,
    map,
    mods: Array.isArray(mods) ? mods.map(Number).filter(Number.isFinite) : [],
    consoleCompatible: typeof consoleCompatible === "boolean" ? consoleCompatible : undefined,
  });
  res.json({ ok: true, id });
}));

// Avvia il provisioning in background (creazione servizio, mappa, mod, impostazioni,
// avvio) e risponde subito: può richiedere minuti (download mod), il chiamante segue
// l'avanzamento su GET /provision/status invece di restare in attesa qui.
router.post("/config/apply", h(async (req, res) => {
  const { id, map, revision, iniOverrides, modUpdateManifest, restoreFrom } = req.body ?? {};
  if (typeof id !== "string" || typeof map !== "string" || !Number.isInteger(revision) || revision < 1) {
    return res.status(400).json({ error: "'id', 'map' e 'revision' positiva richiesti" });
  }
  const profile = await getProfile(id);
  if (!profile) return res.status(404).json({ error: `profilo mappa non trovato: ${id}` });
  // Migrazione trasparente dei profili salvati prima dell'audit ASA: alcune
  // opzioni erano indirizzate al file sbagliato (ImplantSuicideCD,
  // IgnorePVPMountedWeaponryRestrictions). La PWA nuova le salva già nel file
  // corretto, ma i profili esistenti devono funzionare senza risalvarli.
  const migrated = migrateLegacyKeyLocations({
    GameUserSettings: {
      values: { ...((iniOverrides?.gus?.values as Record<string, string> | undefined) ?? {}) },
      sections: { ...((iniOverrides?.gus?.sections as Record<string, string> | undefined) ?? {}) },
      managedKeys: Array.isArray(iniOverrides?.gus?.managedKeys)
        ? iniOverrides.gus.managedKeys.filter((key: unknown): key is string => typeof key === "string")
        : [],
    },
    Game: {
      values: { ...((iniOverrides?.game?.values as Record<string, string> | undefined) ?? {}) },
      sections: { ...((iniOverrides?.game?.sections as Record<string, string> | undefined) ?? {}) },
      managedKeys: Array.isArray(iniOverrides?.game?.managedKeys)
        ? iniOverrides.game.managedKeys.filter((key: unknown): key is string => typeof key === "string")
        : [],
    },
  });
  if (restoreFrom?.objectKey !== undefined) {
    try {
      assertValidObjectKey(restoreFrom.objectKey);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
  }
  const settings: ProvisionSettings = {
    gus: {
      ...migrated.GameUserSettings,
      raw: typeof iniOverrides?.gus?.raw === "string" ? iniOverrides.gus.raw : "",
    },
    game: {
      ...migrated.Game,
      raw: typeof iniOverrides?.game?.raw === "string" ? iniOverrides.game.raw : "",
    },
    launchArgs: typeof iniOverrides?.launchArgs === "string" ? iniOverrides.launchArgs : "",
    configurationRevision: revision,
    modUpdateManifest: Array.isArray(modUpdateManifest)
      ? modUpdateManifest.flatMap((item: unknown) => {
        if (typeof item !== "object" || item === null) return [];
        const value = item as Record<string, unknown>;
        return Number.isInteger(value.id) && Number(value.id) > 0
          ? [{ id: Number(value.id), version: typeof value.version === "string" ? value.version : null }]
          : [];
      })
      : profile.mods.map((modId) => ({ id: modId, version: null })),
    ...(typeof restoreFrom?.objectKey === "string" ? { restoreFrom: { objectKey: restoreFrom.objectKey } } : {}),
  };
  void ensureProvisioned(profile, settings);
  res.json({ map, accepted: true });
}));

router.get("/provision/status", (_req, res) => res.json(getProvisionState()));

router.post("/timer", h(async (req, res) => {
  const m = Number(req.body?.idleStopMinutes);
  if (!Number.isFinite(m) || m < 0) return res.status(400).json({ error: "'idleStopMinutes' >= 0 richiesto" });
  setIdleStopMinutes(m);
  res.json(getWatcherState());
}));

router.get("/timer", (_req, res) => res.json(getWatcherState()));

router.get("/playtime/sessions", h(async (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  res.json(await getClosedSessions(since));
}));

router.get("/playtime/live", (_req, res) => res.json(getLiveSessions()));

router.get("/mods/installed", h(async (_req, res) => {
  res.json(await listInstalledMods());
}));

router.delete("/mods/installed/:id", h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "'id' deve essere un intero" });
  await uninstallMod(id);
  res.json({ ok: true });
}));

router.post("/backup", h(async (_req, res) => {
  // Con ASA online l'archivio va preceduto da saveworld, come nello stop.
  await saveWorldAndSettle();
  const result = await backupSaves();
  res.json(result ?? { ok: false });
}));

router.get("/backup/last", h(async (_req, res) => {
  const last = await readLastBackup();
  if (!last) return res.status(404).json({ error: "nessun backup registrato" });
  res.json(last);
}));

// Ripristina un salvataggio da Object Storage nella sotto-cartella del profilo.
// Da usare PRIMA di avviare ARK per quel profilo.
router.post("/restore", h(async (req, res) => {
  const { profileId, objectKey } = req.body ?? {};
  if (typeof profileId !== "string" || typeof objectKey !== "string") {
    return res.status(400).json({ error: "'profileId' e 'objectKey' richiesti" });
  }
  try {
    assertValidObjectKey(objectKey);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  await restoreSave(profileId, objectKey);
  res.json({ ok: true });
}));

// Rimuove il profilo mappa (solo il file JSON del profilo, vedi deleteProfile).
router.delete("/maps/:id", h(async (req, res) => {
  const id = req.params.id ?? "";
  const removed = await deleteProfile(id);
  if (!removed) return res.status(404).json({ error: `profilo mappa non trovato: ${id}` });
  res.json({ ok: true });
}));
