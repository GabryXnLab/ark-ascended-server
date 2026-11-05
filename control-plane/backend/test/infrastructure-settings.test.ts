import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateInfrastructureOwnedSettings,
  withoutInfrastructureOwnedSettings,
} from "../src/infrastructure-settings.js";
import type { GameConfiguration } from "../src/configs-store.js";

const config: GameConfiguration = {
  id: "test",
  revision: 1,
  name: "Astraeos",
  map: "Astraeos_WP",
  mods: [],
  iniOverrides: {
    gus: {
      values: {
        XPMultiplier: "2",
        ServerAdminPassword: "legacy-secret",
        AdminListURL: "https://example.invalid/admins.txt",
      },
      sections: { ServerAdminPassword: "ServerSettings", AdminListURL: "ServerSettings" },
      raw: "[ServerSettings]\nUpdateAllowedCheatersInterval=600\nKeepMe=True",
      managedKeys: ["XPMultiplier", "ServerAdminPassword", "AdminListURL"],
    },
    game: { values: {}, sections: {}, raw: "" },
  },
  ownerId: "admin",
  ownerName: "Admin",
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

test("rifiuta ServerAdminPassword nei valori e nell'editor raw", () => {
  assert.match(
    validateInfrastructureOwnedSettings("GameUserSettings", { ServerAdminPassword: "secret" }) ?? "",
    /infrastruttura/,
  );
  assert.match(
    validateInfrastructureOwnedSettings("GameUserSettings", {}, "SERVERADMINPASSWORD=secret") ?? "",
    /infrastruttura/,
  );
  assert.match(
    validateInfrastructureOwnedSettings("GameUserSettings", {}, "+ServerAdminPassword=secret") ?? "",
    /infrastruttura/,
  );
  assert.equal(validateInfrastructureOwnedSettings("Game", { ServerAdminPassword: "non-rilevante" }), null);
  assert.match(
    validateInfrastructureOwnedSettings("GameUserSettings", { AdminListURL: "https://example.invalid" }) ?? "",
    /AdminListURL.*infrastruttura/,
  );
  assert.match(
    validateInfrastructureOwnedSettings("GameUserSettings", {}, "UpdateAllowedCheatersInterval=60") ?? "",
    /UpdateAllowedCheatersInterval.*infrastruttura/,
  );
});

test("rifiuta RCONPort: la porta RCON è infrastrutturale", () => {
  assert.match(validateInfrastructureOwnedSettings("GameUserSettings", { RCONPort: "27099" }) ?? "", /RCONPort.*infrastruttura/);
  assert.match(validateInfrastructureOwnedSettings("GameUserSettings", {}, "RCONPort=27099") ?? "", /RCONPort.*infrastruttura/);
});

test("rimuove le impostazioni infrastrutturali legacy senza mutare l'originale", () => {
  const clean = withoutInfrastructureOwnedSettings(config);
  assert.deepEqual(clean.iniOverrides.gus.values, { XPMultiplier: "2" });
  assert.deepEqual(clean.iniOverrides.gus.sections, {});
  assert.equal(clean.iniOverrides.gus.raw, "[ServerSettings]\nKeepMe=True");
  assert.deepEqual(clean.iniOverrides.gus.managedKeys, ["XPMultiplier", "ServerAdminPassword", "AdminListURL"]);
  assert.equal(config.iniOverrides.gus.values.ServerAdminPassword, "legacy-secret");
});
