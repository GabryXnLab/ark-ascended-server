import test from "node:test";
import assert from "node:assert/strict";
import { OfflineWatchdog, type OfflineWatchdogDependencies, type ProvisionProgress } from "../src/offline-watchdog.js";

function harness(initial: Partial<{ state: string; online: boolean | null; shuttingDown: boolean; provision: ProvisionProgress | null }> = {}) {
  const world = {
    state: "RUNNING", online: false as boolean | null, shuttingDown: false, now: 0,
    provision: null as ProvisionProgress | null, ...initial,
  };
  const events: string[] = [];
  const deps: OfflineWatchdogDependencies = {
    instanceState: async () => world.state,
    arkOnline: async () => world.online,
    provisionProgress: async () => world.provision,
    shutdownInProgress: () => world.shuttingDown,
    shutdown: async () => { events.push("shutdown"); },
    notify: async (since, minutes) => { events.push(`notify:${since.getTime()}:${minutes}`); },
    now: () => world.now,
  };
  return { world, events, watchdog: new OfflineWatchdog(deps, 90) };
}

const MIN = 60_000;

test("spegne e notifica dopo 90 minuti di VM accesa con ASA mai online", async () => {
  const { world, events, watchdog } = harness();
  assert.equal(await watchdog.pollOnce(), "counting");
  world.now = 89 * MIN;
  assert.equal(await watchdog.pollOnce(), "counting");
  world.now = 90 * MIN;
  assert.equal(await watchdog.pollOnce(), "triggered");
  assert.deepEqual(events, ["notify:0:90", "shutdown"]);
});

test("l'agent irraggiungibile conta come offline", async () => {
  const { world, events, watchdog } = harness({ online: null });
  await watchdog.pollOnce();
  world.now = 91 * MIN;
  assert.equal(await watchdog.pollOnce(), "triggered");
  assert.ok(events.includes("shutdown"));
});

test("ASA online azzera il conteggio", async () => {
  const { world, events, watchdog } = harness();
  await watchdog.pollOnce();
  world.now = 80 * MIN;
  world.online = true;
  assert.equal(await watchdog.pollOnce(), "online");
  world.online = false;
  world.now = 100 * MIN;
  assert.equal(await watchdog.pollOnce(), "counting");
  world.now = 169 * MIN;
  assert.equal(await watchdog.pollOnce(), "counting");
  assert.deepEqual(events, []);
});

test("VM spenta o in spegnimento non viene toccata", async () => {
  const { world, events, watchdog } = harness({ state: "STOPPED" });
  assert.equal(await watchdog.pollOnce(), "idle");
  world.state = "RUNNING";
  world.shuttingDown = true;
  world.now = 500 * MIN;
  assert.equal(await watchdog.pollOnce(), "idle");
  assert.deepEqual(events, []);
});

test("il conteggio riparte a ogni nuova accensione", async () => {
  const { world, events, watchdog } = harness();
  await watchdog.pollOnce();
  world.now = 60 * MIN;
  world.state = "STOPPED";
  await watchdog.pollOnce();
  world.state = "RUNNING";
  world.now = 70 * MIN;
  assert.equal(await watchdog.pollOnce(), "counting");
  world.now = 150 * MIN;
  assert.equal(await watchdog.pollOnce(), "counting");
  world.now = 160 * MIN;
  assert.equal(await watchdog.pollOnce(), "triggered");
  assert.deepEqual(events, [`notify:${70 * MIN}:90`, "shutdown"]);
});

test("una notifica fallita non impedisce lo spegnimento", async () => {
  const { world } = harness();
  let stopped = false;
  const failing = new OfflineWatchdog({
    instanceState: async () => world.state,
    arkOnline: async () => false,
    provisionProgress: async () => null,
    shutdownInProgress: () => false,
    shutdown: async () => { stopped = true; },
    notify: async () => { throw new Error("vincolo kind non migrato"); },
    now: () => world.now,
  }, 90);
  await failing.pollOnce();
  world.now = 90 * MIN;
  assert.equal(await failing.pollOnce(), "triggered");
  assert.equal(stopped, true);
});

test("non scatta mentre il provisioning avanza, scatta quando resta fermo 15 minuti", async () => {
  const { world, events, watchdog } = harness({ provision: { stage: "updating-game", updatedAt: "t0" } });
  await watchdog.pollOnce();
  world.now = 85 * MIN;
  world.provision = { stage: "updating-mods", updatedAt: "t1" };
  await watchdog.pollOnce();
  world.now = 95 * MIN;
  assert.equal(await watchdog.pollOnce(), "provisioning", "fase cambiata 10 minuti fa");
  world.now = 99 * MIN;
  world.provision = { stage: "updating-mods", updatedAt: "t2" };
  assert.equal(await watchdog.pollOnce(), "provisioning");
  world.now = 113 * MIN;
  assert.equal(await watchdog.pollOnce(), "provisioning");
  world.now = 114 * MIN;
  assert.equal(await watchdog.pollOnce(), "triggered", "nessun avanzamento da 15 minuti");
  assert.deepEqual(events, ["notify:0:90", "shutdown"]);
});

test("provisioning in errore o agent irraggiungibile non rinviano lo spegnimento", async () => {
  for (const provision of [{ stage: "error", updatedAt: "t0" }, null]) {
    const { world, events, watchdog } = harness({ provision });
    await watchdog.pollOnce();
    world.now = 90 * MIN;
    assert.equal(await watchdog.pollOnce(), "triggered");
    assert.ok(events.includes("shutdown"));
  }
});
