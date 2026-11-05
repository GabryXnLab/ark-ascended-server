import assert from "node:assert/strict";
import test from "node:test";
import { ServerOnlineMonitor } from "../src/notification-sync.js";
import type { AgentArkStatus } from "../src/agent.js";
import type { InstanceController, InstanceState } from "../src/oci/types.js";

function controller(state: InstanceState): InstanceController {
  return {
    getInfo: async () => ({ state, ocid: "ocid.test", publicIp: null }),
    start: async () => {},
    stop: async () => {},
  };
}

function arkStatus(online: boolean): AgentArkStatus {
  return {
    online,
    map: null,
    players: [],
    playerCount: 0,
    maxPlayers: null,
    version: null,
    profileId: null,
    configurationRevision: null,
  };
}

test("il monitor osserva offline senza una PWA aperta quando la VM non è RUNNING", async () => {
  const observations: boolean[] = [];
  const monitor = new ServerOnlineMonitor(
    async () => controller("STOPPED"),
    async () => arkStatus(true),
    { observeServerOnline: async (_communityId, _serverId, online) => { observations.push(online); } },
  );
  await monitor.pollOnce();
  assert.deepEqual(observations, [false]);
});

test("il monitor non interpreta un agent temporaneamente irraggiungibile come offline", async () => {
  const observations: boolean[] = [];
  const monitor = new ServerOnlineMonitor(
    async () => controller("RUNNING"),
    async () => null,
    { observeServerOnline: async (_communityId, _serverId, online) => { observations.push(online); } },
  );
  await monitor.pollOnce();
  assert.deepEqual(observations, []);
});

test("il monitor propaga lo stato RCON online osservato dall'agent", async () => {
  const observations: boolean[] = [];
  const monitor = new ServerOnlineMonitor(
    async () => controller("RUNNING"),
    async () => arkStatus(true),
    { observeServerOnline: async (_communityId, _serverId, online) => { observations.push(online); } },
  );
  await monitor.pollOnce();
  assert.deepEqual(observations, [true]);
});
