import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PowerStartCoordinator, isOutOfCapacity } from "../src/power-start.js";
import type { InstanceController, InstanceState } from "../src/oci/types.js";

function fakeController(start: () => Promise<void>): InstanceController {
  let state: InstanceState = "STOPPED";
  return {
    getInfo: async () => ({ state, ocid: "ocid1.instance.test", publicIp: null }),
    start: async () => {
      await start();
      state = "STARTING";
    },
    stop: async () => { state = "STOPPED"; },
  };
}

test("riconosce solo l'errore OCI di capacità recuperabile", () => {
  assert.equal(isOutOfCapacity({ statusCode: 500, message: "Out of host capacity." }), true);
  assert.equal(isOutOfCapacity({ statusCode: 401, message: "Out of host capacity." }), false);
  assert.equal(isOutOfCapacity(new Error("rete non disponibile")), false);
});

test("persiste la richiesta e ritenta automaticamente dopo capacity error", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-power-start-"));
  const stateFile = path.join(dir, "power-start.json");
  let calls = 0;
  const ctrl = fakeController(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("Out of host capacity."), { statusCode: 500 });
  });
  const coordinator = new PowerStartCoordinator(stateFile, 0.01, 0.01, async () => ctrl);

  try {
    const queued = await coordinator.requestStart();
    assert.equal(queued.pending, true);
    assert.equal(queued.accepted, true);
    assert.match(queued.requestId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(queued.attempt, 1);
    assert.match(await readFile(stateFile, "utf8"), /"pending": true/);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls, 2);
    assert.equal((await coordinator.getStatus()).pending, false);
  } finally {
    await coordinator.cancel();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ripristina una richiesta pendente dopo il riavvio del backend", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-power-resume-"));
  const stateFile = path.join(dir, "power-start.json");
  await writeFile(stateFile, JSON.stringify({
    pending: true,
    attempt: 3,
    requestedAt: "2026-08-25T12:00:00.000Z",
    nextAttemptAt: "2099-01-01T00:00:00.000Z",
    lastError: "capacità esaurita",
  }));
  const ctrl = fakeController(async () => {});
  const coordinator = new PowerStartCoordinator(stateFile, 30, 300, async () => ctrl);

  try {
    const restored = await coordinator.getStatus();
    assert.equal(restored.pending, true);
    assert.equal(restored.attempt, 3);
    assert.equal(restored.nextAttemptAt, "2099-01-01T00:00:00.000Z");
  } finally {
    await coordinator.cancel();
    await rm(dir, { recursive: true, force: true });
  }
});

test("una seconda richiesta mentre STARTING non viene accettata di nuovo", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-power-dedupe-"));
  const ctrl = fakeController(async () => {});
  const shared = new PowerStartCoordinator(path.join(dir, "shared.json"), 30, 300, async () => ctrl);
  try {
    assert.equal((await shared.requestStart()).accepted, true);
    const repeated = await shared.requestStart();
    assert.equal(repeated.accepted, false);
    assert.equal(repeated.requestId, null);
  } finally {
    await shared.cancel();
    await rm(dir, { recursive: true, force: true });
  }
});

test("non lascia una richiesta fantasma se la persistenza iniziale fallisce", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-power-unwritable-"));
  const blocker = path.join(dir, "not-a-directory");
  await writeFile(blocker, "x");
  const ctrl = fakeController(async () => {});
  const coordinator = new PowerStartCoordinator(
    path.join(blocker, "power-start.json"),
    30,
    300,
    async () => ctrl,
  );

  try {
    await assert.rejects(() => coordinator.requestStart());
    assert.deepEqual(await coordinator.getStatus(), {
      pending: false,
      requestId: null,
      attempt: 0,
      requestedAt: null,
      nextAttemptAt: null,
      lastError: null,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
