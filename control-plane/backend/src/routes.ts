// Rotte del backend.
//
// Ruoli: admin (illimitato) e friend (permessi granulari, vedi auth.ts). Mappa, mod e
// parametri di gioco cambiano soltanto tramite configurazioni versionate: chi ha accesso
// "con revisione" a un profilo crea una PendingRequest che l'admin approva (vedi admin.ts).

import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "./config.js";
import { getController } from "./oci/index.js";
import { getCostProvider } from "./cost/index.js";
import { agent, trySoft } from "./agent.js";
import { buildPlayerShares } from "./playtime-shares.js";
import { getClosedTotals, getSessionsInRange, type PlayerTotal } from "./playtime-store.js";
import { searchMods, getFeaturedMods, getCategories, getModDetail, getModDescription, getModsByIds, getModUpdateManifest } from "./curseforge.js";
import { requirePermission, requireAdmin } from "./auth.js";
import { createRequest, type ConfigPayload, type PendingRequest } from "./requests-store.js";
import {
  listConfigs, getConfig, upsertConfig, deleteConfig, markConfigApplied,
  getCurrentConfigId, setCurrentConfigId, missingRequiredFields, REQUIRED_CONFIG_FIELD_LABELS,
  normalizeConfigAccess, updateConfigAccess,
  type ConfigAccessControl, type ConfigAccessMode, type GameConfiguration,
} from "./configs-store.js";
import { configCapabilities, type ConfigAccessActor } from "./config-access.js";
import {
  enqueueBootOp, listBootQueue, getQueuedConfigSelectId, clearQueuedConfigSelect,
  clearQueuedAdminWhitelist,
  type AdminWhitelistPayload, type BootQueueOp, type SelectConfigPayload,
} from "./boot-queue-store.js";
import { listSavegames, getSavegame, deleteSavegame } from "./savegames-store.js";
import { recordAgentBackup } from "./savegame-sync.js";
import { serverShutdown } from "./server-shutdown.js";
import { deleteBackup } from "./backup-store.js";
import { DockerApiError } from "./oci/docker-engine.js";
import { powerStart } from "./power-start.js";
import { buildRuntimeConfigurationState } from "./configuration-state.js";
import { LEGACY_COMMUNITY_ID, LEGACY_SERVER_ID } from "./community-model.js";
import { log } from "./logger.js";
import { notifications } from "./notifications-store.js";
import {
  validateInfrastructureOwnedSettings,
  withoutInfrastructureOwnedSettings,
} from "./infrastructure-settings.js";
import {
  getAdminWhitelistState,
  normalizeAdminAccountIds,
  saveAdminWhitelistState,
} from "./admin-whitelist-store.js";
import { listCommunityMemberDirectory } from "./communities-store.js";
import { getIdleStopState, normalizeIdleStopMinutes, saveIdleStopMinutes } from "./idle-stop-store.js";
import { maskSensitiveConfigFields, validateConfigPayloadSettings } from "./config-validation.js";

function h(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

export const router = Router();

async function observeServerOffline(req: Request): Promise<void> {
  try {
    await notifications.observeServerOnline(
      req.communityId ?? LEGACY_COMMUNITY_ID,
      req.communityServerId ?? LEGACY_SERVER_ID,
      false,
    );
  } catch (error) {
    log.warn("Riarmo notifica online dopo spegnimento fallito", error);
  }
}

// GET /status — stato aggregato istanza + ARK + metriche + timer.
router.get("/status", h(async (_req, res) => {
  const ctrl = await getController();
  const instance = await ctrl.getInfo();
  const startRequest = await powerStart.reconcileInstanceState(instance.state);
  await serverShutdown.reconcile(instance.state);

  let ark = null;
  let metrics = null;
  let liveTimer = null;
  if (instance.state === "RUNNING") {
    ark = await trySoft(() => agent.arkStatus());
    metrics = await trySoft(() => agent.metrics());
    liveTimer = await trySoft(() => agent.timer());
  }
  // Il valore mostrato è sempre quello persistito sul control plane; `synced`
  // dice se l'agent lo sta già applicando (null = VM spenta o agent non pronto).
  const { idleStopMinutes } = await getIdleStopState();
  const timer = {
    idleStopMinutes,
    emptySinceSec: liveTimer?.emptySinceSec ?? 0,
    synced: liveTimer ? liveTimer.idleStopMinutes === idleStopMinutes : null,
    offlineWatchdogMinutes: config.offlineWatchdogMinutes,
  };
  const desiredId = (await getQueuedConfigSelectId()) ?? (await getCurrentConfigId());
  const configuration = buildRuntimeConfigurationState(ark, desiredId, await listConfigs());
  const platform = {
    provider: config.instanceProvider,
    gamePort: config.gamePort,
    features: {
      costs: config.instanceProvider !== "docker",
      capacityRetry: config.instanceProvider === "oci",
      storageLabel: config.instanceProvider === "docker" ? "local" : "object-storage",
    },
  };
  res.json({
    instance, powerStart: startRequest, ark, metrics, timer, configuration, shutdown: serverShutdown.status(), platform,
  });
}));

// POST /power/on — avvia l'istanza.
router.post("/power/on", requirePermission("power"), h(async (req, res) => {
  // Un'accensione accodata ora partirebbe da STOPPED mentre la sequenza di
  // spegnimento (backup, SOFTSTOP) non è ancora conclusa.
  const { state } = await (await getController()).getInfo();
  await serverShutdown.reconcile(state);
  if (serverShutdown.status().inProgress) {
    return res.status(409).json({ error: "Spegnimento del server in corso: attendi che la VM risulti spenta, poi riaccendila" });
  }
  let result;
  try {
    result = await powerStart.requestStart();
  } catch (error) {
    if (error instanceof DockerApiError && error.userMessage) {
      return res.status(409).json({ error: error.userMessage });
    }
    throw error;
  }
  if (result.accepted && result.requestId && req.googleUser) {
    try {
      await notifications.recordServerStartRequested(
        req.communityId ?? LEGACY_COMMUNITY_ID,
        req.communityServerId ?? LEGACY_SERVER_ID,
        result.requestId,
        { id: req.googleUser.id, name: req.googleUser.name, avatarUrl: req.googleUser.avatarUrl },
      );
    } catch (error) {
      // L'accensione è già stata accettata: un problema nel feed non deve
      // trasformare l'esito in un 500 ambiguo e indurre l'utente a ripeterla.
      log.warn("Registrazione notifica di accensione fallita", error);
    }
  }
  const { accepted: _accepted, ...powerStartStatus } = result;
  res.status(result.pending ? 202 : 200).json({
    state: result.pending ? "CAPACITY_WAIT" : "STARTING",
    powerStart: powerStartStatus,
  });
}));

// POST /power/off — stessa sequenza dell'auto-stop (saveworld, backup, stop istanza), in background: l'avanzamento si segue in GET /status.shutdown.
router.post("/power/off", requirePermission("power"), h(async (req, res) => {
  await powerStart.cancel();
  const ctrl = await getController();
  const { state } = await ctrl.getInfo();
  if (state === "STOPPED") {
    await observeServerOffline(req);
    res.json({ state: "STOPPED" });
    return;
  }
  void serverShutdown.run("manual")
    .then(() => observeServerOffline(req))
    .catch(() => undefined); // già registrato in shutdown.status().lastError
  res.status(202).json({ state: "STOPPING", shutdown: serverShutdown.status() });
}));

// POST /timer — salva il timer auto-stop sul control plane (valido anche a VM
// spenta) e, se l'agent risponde, lo applica subito; altrimenti lo riallinea
// boot-sync appena l'agent è raggiungibile.
router.post("/timer", requirePermission("timer"), h(async (req, res) => {
  let minutes: number;
  try {
    minutes = normalizeIdleStopMinutes(req.body?.idleStopMinutes);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "valore non valido" });
  }
  const state = await saveIdleStopMinutes(minutes, { id: req.googleUser!.id, name: req.googleUser!.name });
  const ctrl = await getController();
  const { state: instanceState } = await ctrl.getInfo();
  const applied = instanceState === "RUNNING"
    ? (await trySoft(() => agent.setTimer(minutes))) !== null
    : false;
  res.json({ idleStopMinutes: state.idleStopMinutes, applied });
}));

function sameAccountIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// Whitelist nativa ASA: globale, admin-only e separata dalle configurazioni di
// gameplay. La risposta distingue lo stato desiderato persistito sul control
// plane dal file effettivamente leggibile sull'agent.
router.get("/admin-whitelist", requireAdmin, h(async (_req, res) => {
  const desired = await getAdminWhitelistState();
  const ctrl = await getController();
  const { state: instanceState } = await ctrl.getInfo();
  const live = instanceState === "RUNNING"
    ? await trySoft(() => agent.getAdminWhitelist())
    : null;
  const queued = (await listBootQueue()).some((op) => op.kind === "adminWhitelist");
  const accountIds = desired?.accountIds ?? live?.accountIds ?? [];
  res.json({
    accountIds,
    initialized: desired !== null,
    updatedAt: desired?.updatedAt ?? null,
    queued,
    diskMatches: live === null ? null : sameAccountIds(accountIds, live.accountIds),
    instanceState,
  });
}));

let adminWhitelistUpdateTail: Promise<unknown> = Promise.resolve();

function serializeAdminWhitelistUpdate<T>(fn: () => Promise<T>): Promise<T> {
  const task = adminWhitelistUpdateTail.then(fn, fn);
  adminWhitelistUpdateTail = task.then(() => undefined, () => undefined);
  return task;
}

router.put("/admin-whitelist", requireAdmin, h(async (req, res) => {
  let accountIds: string[];
  try {
    accountIds = normalizeAdminAccountIds(req.body?.accountIds);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "accountIds non validi" });
  }

  const actor = req.account!;
  const result = await serializeAdminWhitelistUpdate(async () => {
    const desired = await saveAdminWhitelistState(accountIds, { id: actor.id, name: actor.name });
    const ctrl = await getController();
    const { state: instanceState } = await ctrl.getInfo();
    if (instanceState === "RUNNING") {
      try {
        const live = await agent.setAdminWhitelist(accountIds);
        await clearQueuedAdminWhitelist();
        return {
          status: 200,
          body: {
            accountIds: desired.accountIds,
            initialized: true,
            updatedAt: desired.updatedAt,
            queued: false,
            diskMatches: sameAccountIds(desired.accountIds, live.accountIds),
            instanceState,
          },
        };
      } catch (error) {
        log.warn("Agent non raggiungibile durante l'aggiornamento whitelist: accodo per il boot", error);
      }
    }

    await enqueueBootOp("adminWhitelist", { accountIds });
    return {
      status: 202,
      body: {
        accountIds: desired.accountIds,
        initialized: true,
        updatedAt: desired.updatedAt,
        queued: true,
        diskMatches: null,
        instanceState,
      },
    };
  });
  res.status(result.status).json(result.body);
}));

// --- Applicazione reale delle azioni "a revisione" --------------------------
// Usate sia dal path admin diretto sia da POST /requests/:id/approve (admin.ts).

export class NotRunningError extends Error {
  constructor(public state: string) {
    super(`istanza non RUNNING (stato: ${state})`);
  }
}

async function ensureRunning(): Promise<void> {
  const ctrl = await getController();
  const { state } = await ctrl.getInfo();
  if (state !== "RUNNING") throw new NotRunningError(state);
}

/**
 * Crea/aggiorna il record di una configurazione (solo dati locali, nessuna azione sul
 * game server: quella avviene separatamente in POST /configs/:id/select).
 */
// Anche le proposte approvate passano da qui: vanno validate come il salvataggio
// diretto, perché sono state accodate con regole che nel frattempo possono cambiare.
async function applyConfigSave(payload: ConfigPayload, submittedBy: { id: string; name: string }) {
  const infrastructureError = validateInfrastructureOwnedSettings(
    "GameUserSettings",
    payload.iniOverrides.gus.values,
    payload.iniOverrides.gus.raw,
  );
  if (infrastructureError) throw new ConfigValidationError(infrastructureError);
  const settingsError = validateConfigPayloadSettings(payload.iniOverrides);
  if (settingsError) throw new ConfigValidationError(settingsError);
  const { id, baseRevision, ...input } = payload;
  if (id) {
    const current = await getConfig(id);
    if (!current) throw new ConfigRevisionConflictError("la configurazione non esiste più");
    if (baseRevision !== undefined && current.revision !== baseRevision) {
      throw new ConfigRevisionConflictError(
        `la configurazione è passata dalla revisione ${baseRevision} alla ${current.revision}: ricaricala prima di salvare`,
      );
    }
  }
  return upsertConfig(input, submittedBy, id);
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class ConfigRevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function isConfigInUse(id: string): Promise<boolean> {
  if ((await getQueuedConfigSelectId()) === id || (await getCurrentConfigId()) === id) return true;
  const ctrl = await getController();
  const { state } = await ctrl.getInfo();
  if (state !== "RUNNING") return false;
  const ark = await trySoft(() => agent.arkStatus());
  return ark?.profileId === id;
}

export class ConfigInUseError extends Error {
  constructor() {
    super("configurazione in uso o selezionata per il prossimo avvio: passa prima a un'altra configurazione");
  }
}

/** Richiamata da admin.ts all'approvazione di una PendingRequest. */
export async function applyPendingRequest(request: PendingRequest): Promise<unknown> {
  return applyConfigSave(request.payload, request.submittedBy);
}

// --- Catalogo mod CurseForge (indipendente dallo stato istanza) -------------
// NB: le rotte statiche (search/featured/categories) vanno registrate PRIMA
// di "/mods/:id", altrimenti Express le tratterebbe come id="search" ecc.

router.get("/mods/search", h(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const page = Number(req.query.page ?? 0);
  const categoryId = req.query.categoryId !== undefined ? Number(req.query.categoryId) : undefined;
  res.json(await searchMods(
    q,
    Number.isFinite(page) && page >= 0 ? page : 0,
    20,
    categoryId !== undefined && Number.isFinite(categoryId) ? categoryId : undefined,
  ));
}));

router.get("/mods/featured", h(async (_req, res) => {
  res.json(await getFeaturedMods());
}));

router.get("/mods/categories", h(async (_req, res) => {
  res.json(await getCategories());
}));

router.post("/mods/bulk", h(async (req, res) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: "'ids' (array) richiesto" });
  res.json(await getModsByIds(ids.map(Number).filter(Number.isFinite)));
}));

// NB: /mods/installed è statica ma va PRIMA di /mods/:id, altrimenti Express
// tratterebbe "installed" come :id (Number("installed") = NaN → 400).
router.get("/mods/installed", h(async (_req, res) => {
  const usedBy = await modUsageFromConfigs();

  const ctrl = await getController();
  const { state } = await ctrl.getInfo();

  if (state !== "RUNNING") {
    // Disco non raggiungibile: mostriamo comunque le mod referenziate dalle
    // configurazioni salvate, senza dati di dimensione/data reali.
    const mods = [...usedBy.entries()].map(([id, usedByConfigIds]) => ({
      id,
      sizeBytes: null,
      installedAt: null,
      usedByConfigIds,
      isCatalogKnown: true,
    }));
    return res.json({ available: false, instanceState: state, mods });
  }

  const disk = await trySoft(() => agent.listInstalledMods());
  const merged = new Map<number, { id: number; sizeBytes: number | null; installedAt: string | null }>();
  for (const m of disk ?? []) merged.set(m.id, m);
  for (const id of usedBy.keys()) {
    if (!merged.has(id)) merged.set(id, { id, sizeBytes: null, installedAt: null });
  }
  const mods = [...merged.values()]
    // isCatalogKnown: true solo se l'ID è referenziato da una configurazione salvata
    // (vero ModID CurseForge). Gli ID trovati solo su disco possono essere ID interni
    // EOS assegnati dal gioco e non vanno mai interrogati su CurseForge (400).
    .map((m) => ({ ...m, usedByConfigIds: usedBy.get(m.id) ?? [], isCatalogKnown: usedBy.has(m.id) }))
    .sort((a, b) => a.id - b.id);
  // Se l'istanza è RUNNING ma l'agent non risponde (es. boot in corso), i dati
  // restano "non disponibili" (nessuno scan reale del disco è stato possibile).
  res.json({ available: disk !== null, instanceState: state, mods });
}));

router.get("/mods/:id/description", h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id mod non valido" });
  res.json({ html: await getModDescription(id) });
}));

router.get("/mods/:id", h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id mod non valido" });
  res.json(await getModDetail(id));
}));

// --- Configurazioni salvate (mappa + mod + parametri, pacchetto caricabile) -

function currentConfigActor(req: Request): ConfigAccessActor {
  const userId = req.googleUser!.id;
  const accountId = req.account?.id;
  return {
    userId,
    legacyOwnerIds: accountId && accountId !== userId ? [accountId] : [],
    administrator: req.account?.role === "admin",
  };
}

function publicConfig(req: Request, configuration: GameConfiguration) {
  const capabilities = configCapabilities(configuration, currentConfigActor(req));
  return {
    ...maskSensitiveConfigFields(withoutInfrastructureOwnedSettings(configuration), capabilities.access),
    capabilities,
  };
}

router.get("/config-members", h(async (req, res) => {
  res.json(await listCommunityMemberDirectory(req.communityId ?? LEGACY_COMMUNITY_ID));
}));

router.get("/configs", h(async (req, res) => {
  res.json((await listConfigs()).map((configuration) => publicConfig(req, configuration)));
}));

function normalizeConfigIniSet(input: unknown): ConfigPayload["iniOverrides"]["gus"] {
  const source = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const values: Record<string, string> = {};
  const sections: Record<string, string> = {};
  if (typeof source.values === "object" && source.values !== null) {
    for (const [key, value] of Object.entries(source.values as Record<string, unknown>)) values[key] = String(value);
  }
  if (typeof source.sections === "object" && source.sections !== null) {
    for (const [key, value] of Object.entries(source.sections as Record<string, unknown>)) sections[key] = String(value);
  }
  return {
    values,
    sections,
    raw: typeof source.raw === "string" ? source.raw : "",
    managedKeys: Array.isArray(source.managedKeys)
      ? source.managedKeys.filter((key): key is string => typeof key === "string")
      : [],
  };
}

async function validatedConfigAccess(
  req: Request,
  value: unknown,
  current?: ConfigAccessControl,
): Promise<ConfigAccessControl> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw Object.assign(new Error("'accessControl' non valido"), { code: "COMMUNITY_VALIDATION" });
  }
  const source = value as { administratorLocked?: unknown; grants?: unknown };
  if (source.grants === undefined || typeof source.grants !== "object" || source.grants === null || Array.isArray(source.grants)) {
    throw Object.assign(new Error("'accessControl.grants' deve essere un oggetto"), { code: "COMMUNITY_VALIDATION" });
  }
  const grants: Record<string, ConfigAccessMode> = {};
  for (const [userId, mode] of Object.entries(source.grants)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      throw Object.assign(new Error("identificativo collaboratore non valido"), { code: "COMMUNITY_VALIDATION" });
    }
    if (mode !== "review" && mode !== "full") {
      throw Object.assign(new Error(`livello di accesso non valido per ${userId}`), { code: "COMMUNITY_VALIDATION" });
    }
    grants[userId] = mode;
  }
  const members = await listCommunityMemberDirectory(req.communityId ?? LEGACY_COMMUNITY_ID);
  const activeUserIds = new Set(members.map((member) => member.id));
  // Membership rimosse o sospese non devono restare selezionabili. Un grant
  // storico viene eliminato silenziosamente al successivo salvataggio ACL:
  // restare bloccati su un UUID non più visibile renderebbe l'ACL ingestibile.
  for (const userId of Object.keys(grants)) {
    if (!activeUserIds.has(userId)) delete grants[userId];
  }

  const administrator = req.account?.role === "admin";
  if (!administrator && source.administratorLocked !== undefined
    && source.administratorLocked !== (current?.administratorLocked ?? false)) {
    throw Object.assign(new Error("solo un amministratore può attivare o rimuovere il blocco amministrativo"), {
      code: "COMMUNITY_FORBIDDEN",
    });
  }
  return normalizeConfigAccess({
    administratorLocked: administrator
      ? source.administratorLocked === true
      : current?.administratorLocked ?? false,
    grants,
  });
}

router.post("/configs", h(async (req, res) => {
  // Nome e mappa possono anche essere vuoti qui: una configurazione a metà va
  // comunque salvata (vedi upsertConfig) per non perdere il lavoro in caso di
  // interruzione; sono richiesti solo per l'applicazione reale sul game server
  // (vedi requireCompleteConfig più sotto).
  const { id, name, map, mods, iniOverrides, baseRevision } = req.body ?? {};
  if (typeof name !== "string" || typeof map !== "string") {
    return res.status(400).json({ error: "'name' e 'map' devono essere stringhe" });
  }
  if (id !== undefined && (typeof id !== "string" || !id.trim())) {
    return res.status(400).json({ error: "'id' configurazione non valido" });
  }
  if (baseRevision !== undefined && (!Number.isInteger(baseRevision) || baseRevision < 1)) {
    return res.status(400).json({ error: "'baseRevision' deve essere un intero positivo" });
  }
  const payload: ConfigPayload = {
    ...(typeof id === "string" && id ? { id } : {}),
    ...(Number.isInteger(baseRevision) && baseRevision > 0 ? { baseRevision } : {}),
    name: name.trim(),
    map: map.trim(),
    mods: Array.isArray(mods) ? mods.map(Number).filter(Number.isFinite) : [],
    iniOverrides: {
      gus: normalizeConfigIniSet(iniOverrides?.gus),
      game: normalizeConfigIniSet(iniOverrides?.game),
      launchArgs: typeof iniOverrides?.launchArgs === "string" ? iniOverrides.launchArgs : "",
    },
  };
  const infrastructureError = validateInfrastructureOwnedSettings(
    "GameUserSettings",
    payload.iniOverrides.gus.values,
    payload.iniOverrides.gus.raw,
  );
  if (infrastructureError) return res.status(400).json({ error: infrastructureError });
  const settingsError = validateConfigPayloadSettings(payload.iniOverrides);
  if (settingsError) return res.status(400).json({ error: settingsError });
  const actor = currentConfigActor(req);
  const submittedBy = { id: actor.userId, name: req.googleUser!.name };
  if (!payload.id) {
    const initialAccess = req.body?.accessControl === undefined
      ? normalizeConfigAccess(undefined)
      : await validatedConfigAccess(req, req.body.accessControl);
    const { id: _id, baseRevision: _baseRevision, ...input } = payload;
    const created = await upsertConfig(
      input,
      submittedBy,
      undefined,
      initialAccess,
    );
    return res.status(201).json(publicConfig(req, created));
  }

  const existing = await getConfig(payload.id);
  if (!existing) return res.status(404).json({ error: "configurazione non trovata" });
  const capabilities = configCapabilities(existing, actor);
  if (capabilities.access === "none") {
    return res.status(403).json({ error: "non hai il permesso di modificare questa configurazione" });
  }
  if (capabilities.access === "review") {
    const request = await createRequest("config", submittedBy, payload);
    return res.status(202).json({ status: "pending", request });
  }
  try {
    const saved = await applyConfigSave(payload, submittedBy);
    res.json(publicConfig(req, saved));
  } catch (error) {
    if (error instanceof ConfigRevisionConflictError) return res.status(409).json({ error: error.message });
    if (error instanceof ConfigValidationError) return res.status(400).json({ error: error.message });
    throw error;
  }
}));

router.patch("/configs/:id/access", h(async (req, res) => {
  const configuration = await getConfig(req.params.id ?? "");
  if (!configuration) return res.status(404).json({ error: "configurazione non trovata" });
  const capabilities = configCapabilities(configuration, currentConfigActor(req));
  if (!capabilities.canManageAccess) {
    return res.status(403).json({ error: "non puoi gestire i collaboratori di questa configurazione" });
  }
  const accessControl = await validatedConfigAccess(req, req.body?.accessControl, configuration.accessControl);
  const updated = await updateConfigAccess(configuration.id, accessControl);
  if (!updated) return res.status(404).json({ error: "configurazione non trovata" });
  res.json(publicConfig(req, updated));
}));

router.delete("/configs/:id", h(async (req, res) => {
  const id = req.params.id ?? "";
  const configuration = await getConfig(id);
  if (!configuration) return res.status(404).json({ error: "configurazione non trovata" });
  if (!configCapabilities(configuration, currentConfigActor(req)).canDelete) {
    return res.status(403).json({ error: "solo il proprietario o un amministratore può eliminare questa configurazione" });
  }
  if (await isConfigInUse(id)) {
    return res.status(409).json({ error: new ConfigInUseError().message });
  }
  await deleteConfig(id);
  // Il profilo interno sull'agent (stesso id) non serve più: si ripulisce se la VM è
  // accesa; altrimenti resta un JSON innocuo, ricreato solo se la config tornasse.
  const ctrl = await getController();
  if ((await ctrl.getInfo()).state === "RUNNING") await trySoft(() => agent.deleteProfile(id));
  res.status(204).end();
}));

/**
 * Risponde 422 con l'elenco dei campi obbligatori mancanti se la configurazione non è
 * completa (vedi missingRequiredFields); non blocca il salvataggio, solo l'uso reale
 * sul game server (apply/select), così l'utente sa esattamente cosa completare.
 */
function requireCompleteConfig(cfg: GameConfiguration, res: Response): boolean {
  const missing = missingRequiredFields(cfg);
  if (missing.length === 0) return true;
  const labels = missing.map((field) => REQUIRED_CONFIG_FIELD_LABELS[field]).join(", ");
  res.status(422).json({
    error: `Configurazione incompleta: per poterla eseguire sul server Ark compila prima questi campi obbligatori: ${labels}.`,
    missingFields: missing,
  });
  return false;
}

/**
 * Applica davvero una configurazione sul game server live (istanza già RUNNING e
 * agent raggiungibile). Il provisioning (creazione servizio, mappa, mod,
 * impostazioni, avvio) gira in background sull'agent: questa funzione ritorna
 * appena avviato, il progresso si segue con GET /provision/status.
 */
export class ShutdownInProgressError extends Error {
  constructor() {
    super("spegnimento in corso: la configurazione non viene avviata");
  }
}

export async function applyConfigLive(
  cfg: GameConfiguration,
  restoreFrom?: { objectKey: string },
): Promise<{ map: string }> {
  const snapshot = withoutInfrastructureOwnedSettings(cfg);
  const missing = missingRequiredFields(snapshot);
  if (missing.length > 0) throw new Error(`configurazione incompleta: ${missing.join(", ")}`);
  return serializeConfigApply(async () => {
    const modUpdateManifest = await getModUpdateManifest(snapshot.mods);
    await agent.installMap({ id: snapshot.id, name: snapshot.name, map: snapshot.map, mods: snapshot.mods });
    // Ricontrollo subito prima di avviare ASA: i chiamanti verificano lo
    // spegnimento all'inizio, ma fra le attese precedenti può essere partito.
    if (serverShutdown.status().inProgress) throw new ShutdownInProgressError();
    const result = await agent.applyConfig(
      snapshot.id, snapshot.map, snapshot.revision, snapshot.iniOverrides, modUpdateManifest, restoreFrom,
    );
    // "current" è l'intenzione accettata dall'agent. La revisione effettivamente
    // online è certificata separatamente dall'agent in GET /ark/status.
    await markConfigApplied(snapshot.id);
    await setCurrentConfigId(snapshot.id);
    return result;
  });
}

let configApplyTail: Promise<unknown> = Promise.resolve();
function serializeConfigApply<T>(fn: () => Promise<T>): Promise<T> {
  const task = configApplyTail.then(fn, fn);
  configApplyTail = task.then(() => undefined, () => undefined);
  return task;
}

/**
 * Applica una singola operazione di boot-queue (vedi boot-sync.ts). Se lancia (agent
 * non ancora raggiungibile, ASA ancora in validazione file...) l'operazione resta in
 * coda per il tentativo successivo — chi chiama non deve rimuoverla in quel caso.
 */
export async function applyBootQueueOp(op: BootQueueOp): Promise<void> {
  switch (op.kind) {
    case "selectConfig": {
      const id = (op.payload as SelectConfigPayload).id;
      const cfg = await getConfig(id);
      if (!cfg) return; // configurazione cancellata nel frattempo: nulla da applicare
      await applyConfigLive(cfg);
      return;
    }
    case "adminWhitelist":
      await serializeAdminWhitelistUpdate(async () => {
        await ensureRunning();
        // Se un admin ha salvato di nuovo la lista mentre boot-sync stava
        // leggendo la coda, applica sempre lo stato desiderato più recente.
        const desired = await getAdminWhitelistState();
        const accountIds = desired?.accountIds ?? (op.payload as AdminWhitelistPayload).accountIds;
        await agent.setAdminWhitelist(accountIds);
      });
      return;
  }
}

// GET /provision/status — avanzamento del provisioning in corso sull'agent (fasi +
// tempo trascorso, vedi server-agent/src/provision.ts). Nessun provisioning attivo
// o istanza spenta → stage "idle", senza contattare l'agent in quel caso.
router.get("/provision/status", h(async (_req, res) => {
  const ctrl = await getController();
  const { state } = await ctrl.getInfo();
  if (state !== "RUNNING") {
    return res.json({ stage: "idle", mapId: null, startedAt: null, updatedAt: new Date().toISOString() });
  }
  const status = await trySoft(() => agent.provisionStatus());
  res.json(status ?? { stage: "idle", mapId: null, startedAt: null, updatedAt: new Date().toISOString() });
}));

// GET /configs/queued — id della configurazione che risulterà attiva al prossimo avvio:
// quella esplicitamente scelta a server spento se presente, altrimenti quella già
// corrente (l'ultima applicata con successo), così la PWA mostra sempre una "predefinita
// attuale" quando ne esiste una, non solo quando l'utente ha appena cambiato scelta.
router.get("/configs/queued", h(async (_req, res) => {
  const queuedId = await getQueuedConfigSelectId();
  res.json({ id: queuedId ?? (await getCurrentConfigId()) });
}));

// GET /boot-queue — operazioni dirette (whitelist admin/mod/ini/installazione mappa/selezione config)
// in attesa di essere applicate al prossimo avvio (vedi boot-queue-store.ts/boot-sync.ts),
// più recente per bersaglio. Usata dalla PWA per mostrare cosa verrà applicato/sta venendo
// applicato mentre il game server era spento.
router.get("/boot-queue", h(async (req, res) => {
  const operations = await listBootQueue();
  // Gli EOS/ARK ID che concedono privilegi non devono essere distribuiti ai
  // membri attraverso la coda generica visibile nella dashboard.
  res.json(req.account?.role === "admin"
    ? operations
    : operations.filter((op) => op.kind !== "adminWhitelist"));
}));

/** Errore di trasporto verso l'agent (rete, timeout), non una risposta d'errore dell'agent. */
function isAgentUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch failed / ECONNREFUSED
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * POST /configs/:id/select — sceglie la configurazione "in uso", a prescindere
 * dallo stato di accensione: se l'istanza è RUNNING e l'agent risponde la applica
 * subito; altrimenti (VM spenta, agent non ancora pronto nel boot, spegnimento in
 * corso) la mette in coda e boot-sync la applica appena possibile.
 */
router.post("/configs/:id/select", requirePermission("applyConfig"), h(async (req, res) => {
  const id = req.params.id ?? "";
  const cfg = await getConfig(id);
  if (!cfg) return res.status(404).json({ error: "configurazione non trovata" });
  if (!requireCompleteConfig(cfg, res)) return;
  const ctrl = await getController();
  const { state } = await ctrl.getInfo();
  if (state === "RUNNING" && !serverShutdown.status().inProgress
    && (await trySoft(() => agent.provisionStatus())) !== null) {
    try {
      const { map } = await applyConfigLive(cfg);
      await clearQueuedConfigSelect();
      return res.json({ applied: true, map });
    } catch (error) {
      if (error instanceof ShutdownInProgressError) {
        log.info("Spegnimento iniziato durante la selezione configurazione: la accodo");
      } else if (!isAgentUnreachable(error)) {
        throw error;
      } else {
        log.warn("Agent irraggiungibile durante la selezione configurazione: la accodo", error);
      }
    }
  }
  await enqueueBootOp("selectConfig", { id: cfg.id });
  res.json({ applied: false, queued: true, instanceState: state });
}));

// --- Libreria mod condivisa (installate sul disco del game server) ---------
// Un solo game install condiviso da tutte le configurazioni: una mod con lo
// stesso ModID è già scaricata una volta sola a livello di filesystem (vedi
// server-agent/src/mods-library.ts). Qui diamo visibilità: cosa c'è su disco,
// quanto spazio occupa, e quali configurazioni la referenziano.

/** ModID → id delle configurazioni che lo referenziano, incrociando listConfigs(). */
async function modUsageFromConfigs(): Promise<Map<number, string[]>> {
  const usedBy = new Map<number, string[]>();
  for (const c of await listConfigs()) {
    for (const modId of c.mods) {
      const arr = usedBy.get(modId) ?? [];
      arr.push(c.id);
      usedBy.set(modId, arr);
    }
  }
  return usedBy;
}

router.delete("/mods/installed/:id", requireAdmin, h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "'id' deve essere un intero" });

  const ctrl = await getController();
  const { state } = await ctrl.getInfo();
  if (state !== "RUNNING") {
    return res.status(409).json({ error: "istanza non RUNNING: il disco del game server non è raggiungibile" });
  }

  const usedBy = await modUsageFromConfigs();
  const usedByConfigIds = usedBy.get(id) ?? [];
  if (usedByConfigIds.length > 0) {
    return res.status(409).json({
      error: `mod ancora usata da ${usedByConfigIds.length} configurazioni: rimuovila prima da lì, altrimenti verrebbe riscaricata al prossimo avvio`,
    });
  }

  await agent.uninstallMod(id);
  res.status(204).end();
}));

// --- Salvataggi (backup/restore delle partite) ------------------------------
// Solo admin: le partite salvate sono gestibili esclusivamente dall'amministratore
// (scelta esplicita, nessun percorso di proposta per gli amici). Copia singola per
// configurazione su Object Storage, indipendente dalle configurazioni: cancellare
// una configurazione non tocca mai questi record.

router.get("/savegames", requireAdmin, h(async (_req, res) => {
  res.json(await listSavegames());
}));

// POST /backup — forza subito un backup della partita attiva (istanza RUNNING) e
// registra/aggiorna il record del salvataggio senza aspettare il sync periodico.
router.post("/backup", requireAdmin, h(async (_req, res) => {
  try {
    await ensureRunning();
  } catch (e) {
    if (e instanceof NotRunningError) return res.status(409).json({ error: e.message });
    throw e;
  }
  const result = await agent.backup();
  if (!("objectKey" in result) || !result.profileId) {
    return res.status(409).json({ error: "nessuna partita attiva di cui fare backup" });
  }
  res.json(await recordAgentBackup(result));
}));

// DELETE /savegames/:id — cancella il backup dallo store (Object Storage o cartella locale;
// non serve l'istanza accesa) poi rimuove il record. Sempre admin, nessuna eccezione.
router.delete("/savegames/:id", requireAdmin, h(async (req, res) => {
  const id = req.params.id ?? "";
  const sg = await getSavegame(id);
  if (!sg) return res.status(404).json({ error: "salvataggio non trovato" });
  await deleteBackup(sg.objectKey);
  await deleteSavegame(id);
  res.status(204).end();
}));

// POST /savegames/:id/restore — ripristina la partita: risolve la configurazione
// (ricreandola dallo snapshot se era stata cancellata) e avvia il provisioning con
// restoreFrom, che scarica ed estrae il salvataggio prima di avviare ARK. Quella
// configurazione diventa l'attiva, come con POST /configs/:id/select.
router.post("/savegames/:id/restore", requireAdmin, h(async (req, res) => {
  const id = req.params.id ?? "";
  const sg = await getSavegame(id);
  if (!sg) return res.status(404).json({ error: "salvataggio non trovato" });

  try {
    await ensureRunning();
  } catch (e) {
    if (e instanceof NotRunningError) return res.status(409).json({ error: e.message });
    throw e;
  }

  let cfg = sg.configId ? await getConfig(sg.configId) : undefined;
  if (!cfg) {
    // La configurazione originaria è stata cancellata: la ricreiamo dallo snapshot
    // del salvataggio così il profilo torna a esistere per il ripristino. L'id resta
    // quello del salvataggio (== profileId), così backup e sotto-cartella di
    // salvataggio continuano a combaciare. Proprietario = chi ripristina, così la
    // configurazione ricreata ha un titolare reale nell'ACL.
    cfg = await upsertConfig(
      {
        name: sg.configName,
        map: sg.map,
        mods: sg.mods,
        iniOverrides: { gus: { values: {}, sections: {} }, game: { values: {}, sections: {} } },
      },
      { id: req.googleUser!.id, name: req.googleUser!.name },
      sg.id,
    );
  }

  let map: string;
  try {
    ({ map } = await applyConfigLive(cfg, { objectKey: sg.objectKey }));
  } catch (e) {
    if (e instanceof ShutdownInProgressError) return res.status(409).json({ error: "Spegnimento del server in corso: riprova dopo la riaccensione" });
    throw e;
  }
  await clearQueuedConfigSelect();
  res.json({ map });
}));

// GET /playtime/summary?month=YYYY-MM — tempo per giocatore e riparto del costo mensile.
router.get("/playtime/summary", h(async (req, res) => {
  const monthParam = typeof req.query.month === "string" ? req.query.month : undefined;
  if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
    return res.status(400).json({ error: "'month' deve avere formato YYYY-MM" });
  }
  const now = new Date();
  const [year, mon] = monthParam
    ? monthParam.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const monthStart = new Date(Date.UTC(year!, mon! - 1, 1));
  const monthEnd = new Date(Date.UTC(year!, mon!, 1));

  const totals = new Map<string, PlayerTotal>();
  for (const t of await getClosedTotals(monthStart, monthEnd)) totals.set(t.id, { ...t });

  const ctrl = await getController();
  const { state } = await ctrl.getInfo();
  if (state === "RUNNING") {
    const live = await trySoft(() => agent.playtimeLive());
    const nowMs = Math.min(Date.now(), monthEnd.getTime());
    for (const s of live ?? []) {
      const overlapSec = Math.max(0, nowMs - Math.max(Date.parse(s.startedAt), monthStart.getTime())) / 1000;
      if (overlapSec <= 0) continue;
      const cur = totals.get(s.playerId) ?? { id: s.playerId, name: s.name, seconds: 0 };
      cur.name = s.name;
      cur.seconds += overlapSec;
      totals.set(s.playerId, cur);
    }
  }

  // Per il mese corrente il periodo termina "adesso" (ancora in corso); per un
  // mese passato concluso termina alla fine di quel mese (monthEnd).
  const costPeriodEnd = new Date(Math.min(monthEnd.getTime(), now.getTime()));
  const costProvider = await getCostProvider();
  const cost = costProvider ? await costProvider.getMonthlyCost(monthStart, costPeriodEnd) : null;
  const players = [...totals.values()].sort((a, b) => b.seconds - a.seconds);
  const totalSeconds = players.reduce((sum, p) => sum + p.seconds, 0);

  const shares = buildPlayerShares(players, totalSeconds, cost);

  res.json({
    month: `${year}-${String(mon).padStart(2, "0")}`,
    totalCost: cost ? { amount: cost.amount, currency: cost.currency } : null,
    totalSeconds: Math.round(totalSeconds),
    players: shares,
  });
}));

// GET /playtime/log?month=YYYY-MM — log dettagliato entrata/uscita per sessione, solo admin.
router.get("/playtime/log", requireAdmin, h(async (req, res) => {
  const monthParam = typeof req.query.month === "string" ? req.query.month : undefined;
  if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
    return res.status(400).json({ error: "'month' deve avere formato YYYY-MM" });
  }
  const now = new Date();
  const [year, mon] = monthParam
    ? monthParam.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const monthStart = new Date(Date.UTC(year!, mon! - 1, 1));
  const monthEnd = new Date(Date.UTC(year!, mon!, 1));

  const closed = (await getSessionsInRange(monthStart, monthEnd)).map((s) => ({
    playerId: s.playerId,
    name: s.name,
    startedAt: s.startedAt,
    endedAt: s.endedAt as string | null,
    durationSec: Math.round(s.durationSec),
  }));

  const ctrl = await getController();
  const { state } = await ctrl.getInfo();
  const open: typeof closed = [];
  if (state === "RUNNING") {
    const live = await trySoft(() => agent.playtimeLive());
    for (const s of live ?? []) {
      if (Date.parse(s.startedAt) >= monthEnd.getTime()) continue;
      open.push({ playerId: s.playerId, name: s.name, startedAt: s.startedAt, endedAt: null, durationSec: s.elapsedSec });
    }
  }

  const sessions = [...open, ...closed].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  res.json({ month: `${year}-${String(mon).padStart(2, "0")}`, sessions });
}));
