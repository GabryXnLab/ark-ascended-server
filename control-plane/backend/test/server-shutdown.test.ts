import test from "node:test";
import assert from "node:assert/strict";
import {
  ServerShutdown, waitForProvisioningSettled, type PersistedShutdown, type ShutdownDependencies, type ShutdownStore,
} from "../src/server-shutdown.js";

function memoryStore(initial: PersistedShutdown | null = null) {
  const store = {
    saved: initial,
    async load() { return store.saved; },
    async save(intent: PersistedShutdown) { store.saved = { ...intent }; },
    async clear() { store.saved = null; },
  } satisfies ShutdownStore & { saved: PersistedShutdown | null };
  return store;
}

function fakeDeps(overrides: Partial<ShutdownDependencies> = {}) {
  const calls: string[] = [];
  const deps: ShutdownDependencies = {
    onlineCertified: async () => true,
    provisionStage: async () => "online",
    sleep: async () => undefined,
    now: () => 0,
    stopArk: async () => { calls.push("stopArk"); },
    backup: async () => {
      calls.push("backup");
      return { profileId: "p", map: "TheIsland_WP", mods: [], objectKey: "saves/p.tar.zst", sizeBytes: 1, backedUpAt: "2026-09-30T00:00:00.000Z" };
    },
    recordBackup: async () => { calls.push("record"); },
    stopInstance: async () => { calls.push("stopInstance"); },
    ...overrides,
  };
  return { calls, deps };
}

test("salva, fa il backup, lo registra e poi spegne la VM", async () => {
  const { calls, deps } = fakeDeps();
  const shutdown = new ServerShutdown(async () => deps, memoryStore());
  await shutdown.run("manual");
  assert.deepEqual(calls, ["stopArk", "backup", "record", "stopInstance"]);
  await shutdown.reconcile("STOPPED");
  assert.equal(shutdown.status().inProgress, false);
});

test("stop ARK o backup falliti non impediscono lo spegnimento", async () => {
  const { calls, deps } = fakeDeps({
    stopArk: async () => { throw new Error("agent irraggiungibile"); },
    backup: async () => { throw new Error("timeout"); },
  });
  await new ServerShutdown(async () => deps, memoryStore()).run("manual");
  assert.deepEqual(calls, ["stopInstance"]);
});

test("il watchdog non fa mai il backup", async () => {
  const { calls, deps } = fakeDeps();
  await new ServerShutdown(async () => deps, memoryStore()).run("watchdog");
  assert.deepEqual(calls, ["stopArk", "stopInstance"]);
});

test("senza RCON-online certificato (o con agent vecchio/irraggiungibile) il backup viene saltato", async () => {
  for (const onlineCertified of [async () => false, async () => { throw new Error("timeout"); }]) {
    const { calls, deps } = fakeDeps({ onlineCertified });
    await new ServerShutdown(async () => deps, memoryStore()).run("manual");
    assert.deepEqual(calls, ["stopArk", "stopInstance"]);
  }
});

test("backup disattivato non registra nulla", async () => {
  const { calls, deps } = fakeDeps({ backup: async () => ({ ok: false }) });
  await new ServerShutdown(async () => deps, memoryStore()).run("manual");
  assert.deepEqual(calls, ["stopArk", "stopInstance"]);
});

test("una seconda richiesta durante lo spegnimento riusa la sequenza in corso", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { calls, deps } = fakeDeps({ stopArk: async () => { calls.push("stopArk"); await gate; } });
  const shutdown = new ServerShutdown(async () => deps, memoryStore());
  const first = shutdown.run("manual");
  const second = shutdown.run("watchdog");
  assert.equal(shutdown.status().inProgress, true);
  assert.equal(shutdown.status().reason, "manual");
  release();
  await Promise.all([first, second]);
  assert.equal(calls.filter((call) => call === "stopInstance").length, 1);
});

test("un errore OCI resta visibile in lastError", async () => {
  const { deps } = fakeDeps({ stopInstance: async () => { throw new Error("OCI 500"); } });
  const shutdown = new ServerShutdown(async () => deps, memoryStore());
  await assert.rejects(shutdown.run("manual"));
  assert.equal(shutdown.status().lastError, "OCI 500");
  assert.equal(shutdown.status().inProgress, false);
});

test("l'intenzione resta persistita dopo il SOFTSTOP e decade solo a VM STOPPED", async () => {
  const { deps } = fakeDeps();
  const store = memoryStore();
  const shutdown = new ServerShutdown(async () => deps, store);
  await shutdown.run("manual");
  assert.equal(store.saved?.phase, "stop-requested");
  assert.equal(shutdown.status().inProgress, true, "boot-sync non deve riavviare ASA mentre la VM si ferma");
  await shutdown.reconcile("RUNNING");
  await shutdown.reconcile("STOPPING");
  assert.equal(shutdown.status().inProgress, true);
  await shutdown.reconcile("STOPPED");
  assert.equal(shutdown.status().inProgress, false);
  assert.equal(store.saved, null);
});

test("dopo un restart del backend a metà sequenza lo spegnimento riprende invece di riavviare ASA", async () => {
  const { calls, deps } = fakeDeps();
  const store = memoryStore({ reason: "manual", startedAt: "2026-09-30T10:00:00.000Z", phase: "running" });
  const shutdown = new ServerShutdown(async () => deps, store);
  await shutdown.init();
  assert.deepEqual(shutdown.status(), {
    inProgress: true, reason: "manual", startedAt: "2026-09-30T10:00:00.000Z", lastError: null,
  });
  await shutdown.reconcile("RUNNING");
  await shutdown.run("manual"); // attende la sequenza ripresa
  assert.deepEqual(calls, ["stopArk", "backup", "record", "stopInstance"]);
  assert.equal(store.saved?.startedAt, "2026-09-30T10:00:00.000Z");
  assert.equal(store.saved?.phase, "stop-requested");
});

test("con SOFTSTOP già accettato un restart non ripete la sequenza", async () => {
  const { calls, deps } = fakeDeps();
  const store = memoryStore({ reason: "watchdog", startedAt: "2026-09-30T10:00:00.000Z", phase: "stop-requested" });
  const shutdown = new ServerShutdown(async () => deps, store);
  await shutdown.reconcile("RUNNING");
  assert.deepEqual(calls, []);
  assert.equal(shutdown.status().inProgress, true);
});

test("uno stop OCI fallito rimuove l'intenzione persistita", async () => {
  const { deps } = fakeDeps({ stopInstance: async () => { throw new Error("OCI 500"); } });
  const store = memoryStore();
  await assert.rejects(new ServerShutdown(async () => deps, store).run("manual"));
  assert.equal(store.saved, null);
});

function clockDeps(stages: Array<string | null | Error>) {
  let time = 0;
  const seen: Array<string | null> = [];
  return {
    seen,
    provisionStage: async () => {
      const next = stages.length > 1 ? stages.shift()! : stages[0]!;
      if (next instanceof Error) throw next;
      seen.push(next);
      return next;
    },
    sleep: async (ms: number) => { time += ms; },
    now: () => time,
  };
}

test("il backup attende che il provisioning annullato dallo stop sia fermo", async () => {
  const clock = clockDeps(["updating-game", "updating-game", "idle"]);
  const { calls, deps } = fakeDeps(clock);
  await new ServerShutdown(async () => deps, memoryStore()).run("manual");
  assert.deepEqual(clock.seen, ["updating-game", "updating-game", "idle"]);
  assert.deepEqual(calls, ["stopArk", "backup", "record", "stopInstance"]);
});

test("se il provisioning non si ferma entro il timeout il backup viene saltato", async () => {
  const { calls, deps } = fakeDeps(clockDeps(["waiting-online"]));
  await new ServerShutdown(async () => deps, memoryStore()).run("manual");
  assert.deepEqual(calls, ["stopArk", "stopInstance"]);
});

test("un agent irraggiungibile durante l'attesa non conta come provisioning fermo", async () => {
  assert.equal(await waitForProvisioningSettled(clockDeps([null])), false);
  assert.equal(await waitForProvisioningSettled(clockDeps([new Error("timeout"), "error"])), true);
});
