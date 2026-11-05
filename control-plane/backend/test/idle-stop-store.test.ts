import { after, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const tmpDir = path.join(os.tmpdir(), `arksa-idle-stop-${process.pid}`);
process.env.IDLE_STOP_DATA_FILE = path.join(tmpDir, "idle-stop.json");
process.env.IDLE_STOP_MINUTES = "20";

const store = await import("../src/idle-stop-store.js");

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("senza file usa il default dell'agent", async () => {
  const state = await store.getIdleStopState();
  assert.equal(state.idleStopMinutes, 20);
  assert.equal(state.updatedAt, null);
});

test("persiste il valore e lo rilegge anche dopo un riavvio del processo", async () => {
  await store.saveIdleStopMinutes(45, { id: "u", name: "Gaia" });
  const reloaded = await import(`../src/idle-stop-store.js?reload=${Date.now()}`);
  const state = await reloaded.getIdleStopState();
  assert.equal(state.idleStopMinutes, 45);
  assert.deepEqual(state.updatedBy, { id: "u", name: "Gaia" });
});

test("rifiuta valori non interi o fuori intervallo", () => {
  assert.throws(() => store.normalizeIdleStopMinutes(-1));
  assert.throws(() => store.normalizeIdleStopMinutes(2.5));
  assert.throws(() => store.normalizeIdleStopMinutes(24 * 60 + 1));
  assert.equal(store.normalizeIdleStopMinutes("0"), 0);
});

test("riallinea l'agent solo se il valore differisce", async () => {
  const writes: number[] = [];
  const write = async (minutes: number) => { writes.push(minutes); };
  assert.equal(await store.reconcileAgentIdleStop(30, async () => ({ idleStopMinutes: 30 }), write), true);
  assert.deepEqual(writes, []);
  assert.equal(await store.reconcileAgentIdleStop(30, async () => ({ idleStopMinutes: 20 }), write), true);
  assert.deepEqual(writes, [30]);
  assert.equal(await store.reconcileAgentIdleStop(30, async () => null, write), null);
  assert.deepEqual(writes, [30]);
});
