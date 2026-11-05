// Verifica la sequenza di stage del provisioning "process"-only (nessun servizio
// da creare/configurare: arresto della sessione precedente, impostazioni,
// eventuale restore, avvio, attesa online) e la protezione da provisioning
// concorrenti sovrapposti.

import "./provision-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { config } from "../src/config.js";
import { saveProfile, type MapProfile } from "../src/maps.js";
import { cancelProvisioning, ensureProvisioned, getProvisionState } from "../src/provision.js";
import { __mock, arkStatus, startArk, stopArk } from "../src/ark.js";

const emptyIni = { values: {}, sections: {} };
const profile: MapProfile = { id: "test-provision", name: "Test", map: "TestMap_WP", mods: [] };

test.before(async () => {
  await saveProfile(profile);
});

test.after(async () => {
  await fs.rm(config.mapsDir, { recursive: true, force: true });
  await fs.rm(config.activeMapFile, { force: true });
  await fs.rm(config.activeProfileFile, { force: true });
  await fs.rm(config.activeConfigFile, { force: true });
  await fs.rm(config.modVersionsFile, { force: true });
  await fs.rm(config.activeModsFile, { force: true });
  await fs.rm(config.gusIni, { force: true });
  await fs.rm(config.gameIni, { force: true });
  await fs.rm(`${config.gusIni}.arksa-managed.json`, { force: true });
  await fs.rm(`${config.gameIni}.arksa-managed.json`, { force: true });
  await fs.rm(config.launchArgsFile, { force: true });
});

test("ensureProvisioned arriva a 'online' senza restoreFrom", async () => {
  __mock.setOnline(false);
  await ensureProvisioned(profile, { gus: emptyIni, game: emptyIni });
  assert.equal(getProvisionState().stage, "online");
  assert.equal((await fs.readFile(config.activeProfileFile, "utf8")).trim(), profile.id);
});

test("registra la revisione solo dopo che la configurazione è online", async () => {
  __mock.setOnline(false);
  await ensureProvisioned(profile, { gus: emptyIni, game: emptyIni, configurationRevision: 2 });
  const active = JSON.parse(await fs.readFile(config.activeConfigFile, "utf8")) as { id: string; revision: number };
  assert.deepEqual({ id: active.id, revision: active.revision }, { id: profile.id, revision: 2 });
});

test("certifica le versioni mod soltanto al completamento online", async () => {
  __mock.setOnline(false);
  await ensureProvisioned(profile, {
    gus: emptyIni,
    game: emptyIni,
    configurationRevision: 3,
    modUpdateManifest: [{ id: 988598, version: "file:42:2026-08-27T10:00:00Z" }],
  });
  const stored = JSON.parse(await fs.readFile(config.modVersionsFile, "utf8")) as { versions: Record<string, string> };
  assert.equal(stored.versions["988598"], "file:42:2026-08-27T10:00:00Z");
});

test("con restoreFrom completa comunque a 'online' (nessuna eccezione dal branch restoring-save)", async () => {
  __mock.setOnline(false);
  await ensureProvisioned(profile, { gus: emptyIni, game: emptyIni, restoreFrom: { objectKey: "saves/test-provision.tar.zst" } });
  assert.equal(getProvisionState().stage, "online");
});

test("le richieste concorrenti vengono serializzate e l'ultima revisione resta attiva", async () => {
  __mock.setOnline(false);
  const p1 = ensureProvisioned(profile, { gus: emptyIni, game: emptyIni, configurationRevision: 3 });
  const p2 = ensureProvisioned(profile, { gus: emptyIni, game: emptyIni, configurationRevision: 4 });
  await Promise.all([p1, p2]);
  assert.equal(getProvisionState().stage, "online");
  const active = JSON.parse(await fs.readFile(config.activeConfigFile, "utf8")) as { id: string; revision: number };
  assert.deepEqual({ id: active.id, revision: active.revision }, { id: profile.id, revision: 4 });
});

test("onlineCertifiedAt sopravvive allo stop e si azzera a ogni nuovo avvio di ASA", async () => {
  await startArk(profile.map, profile.id);
  __mock.setOnline(false);
  assert.equal((await arkStatus()).onlineCertifiedAt, null, "avviato ma mai online");
  __mock.setOnline(true);
  const certified = (await arkStatus()).onlineCertifiedAt;
  assert.ok(certified);
  await stopArk();
  assert.equal((await arkStatus()).onlineCertifiedAt, certified, "lo spegnimento legge il valore dopo lo stop");
  await startArk(profile.map, profile.id);
  __mock.setOnline(false);
  assert.equal((await arkStatus()).onlineCertifiedAt, null, "un nuovo avvio (es. cambio profilo) richiede un nuovo RCON-online");
});

test("cancelProvisioning ferma il provisioning in corso e quelli in coda prima di avviare ASA", async () => {
  __mock.setOnline(false);
  const running = ensureProvisioned(profile, { gus: emptyIni, game: emptyIni, configurationRevision: 10 });
  const queued = ensureProvisioned(profile, { gus: emptyIni, game: emptyIni, configurationRevision: 11 });
  cancelProvisioning();
  await Promise.all([running, queued]);
  assert.equal((await arkStatus()).online, false, "ASA non deve ripartire dopo lo stop dello spegnimento");
  assert.ok(["idle", "online", "error"].includes(getProvisionState().stage), "nessun provisioning resta in corso");
  const active = JSON.parse(await fs.readFile(config.activeConfigFile, "utf8")) as { revision: number };
  assert.ok(active.revision < 10, "le revisioni annullate non vengono certificate");
  await ensureProvisioned(profile, { gus: emptyIni, game: emptyIni, configurationRevision: 12 });
  assert.equal(getProvisionState().stage, "online", "un provisioning richiesto dopo l'annullamento parte normalmente");
});
