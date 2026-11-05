import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeConfigurationState } from "../src/configuration-state.js";
import type { AgentArkStatus } from "../src/agent.js";
import type { GameConfiguration } from "../src/configs-store.js";

function gameConfig(id: string, revision: number): GameConfiguration {
  return {
    id, revision, name: id, map: `${id}_WP`, mods: [],
    iniOverrides: { gus: { values: {}, sections: {} }, game: { values: {}, sections: {} } },
    ownerId: "admin", ownerName: "Admin", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}

function ark(profileId: string, revision: number): AgentArkStatus {
  return {
    online: true, map: `${profileId}_WP`, players: [], playerCount: 0,
    maxPlayers: 20, version: null, profileId, configurationRevision: revision,
  };
}

test("segnala soltanto una revisione nuova della configurazione attiva", () => {
  const configs = [gameConfig("attiva", 2), gameConfig("inattiva", 5)];
  assert.equal(buildRuntimeConfigurationState(ark("attiva", 1), "attiva", configs).stale, true);
  assert.equal(buildRuntimeConfigurationState(ark("attiva", 2), "attiva", configs).stale, false);

  // Una modifica al profilo inattivo non deve disturbare la sessione corrente.
  configs[1]!.revision = 6;
  assert.equal(buildRuntimeConfigurationState(ark("attiva", 2), "inattiva", configs).stale, false);
});

test("mantiene distinti profilo effettivo e profilo selezionato durante un cambio", () => {
  const configs = [gameConfig("vecchia", 3), gameConfig("nuova", 7)];
  assert.deepEqual(buildRuntimeConfigurationState(ark("vecchia", 3), "nuova", configs), {
    activeId: "vecchia",
    activeRevision: 3,
    desiredId: "nuova",
    desiredRevision: 7,
    stale: false,
  });
});

