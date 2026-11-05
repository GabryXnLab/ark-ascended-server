import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyKeyLocations } from "../src/shared/config-rules.js";
import { MANAGED_KEYS_BASELINE } from "../src/managed-settings-baseline.js";

const { ALL_GAME_SETTING_FIELDS } = await import(
  new URL("../../control-plane/pwa/src/gameSettingsSchema.ts", import.meta.url).href
) as { ALL_GAME_SETTING_FIELDS: Array<{ key: string; file: string }> };

test("i profili salvati con le chiavi nel file sbagliato vengono migrati senza risalvarli", () => {
  const migrated = migrateLegacyKeyLocations({
    GameUserSettings: {
      values: { IgnorePVPMountedWeaponryRestrictions: "True", XPMultiplier: "2" },
      sections: {},
      managedKeys: ["IgnorePVPMountedWeaponryRestrictions", "XPMultiplier"],
    },
    Game: {
      values: { ImplantSuicideCD: "600" },
      sections: { ImplantSuicideCD: "/script/shootergame.shootergamemode" },
      managedKeys: ["ImplantSuicideCD", "KillXPMultiplier"],
    },
  });
  assert.deepEqual(migrated.GameUserSettings.values, { XPMultiplier: "2", ImplantSuicideCD: "600" });
  assert.deepEqual(migrated.Game.values, { IgnorePVPMountedWeaponryRestrictions: "True" });
  assert.deepEqual(migrated.Game.sections, {});
  assert.deepEqual(migrated.GameUserSettings.managedKeys, ["XPMultiplier", "ImplantSuicideCD"]);
  assert.deepEqual(migrated.Game.managedKeys, ["KillXPMultiplier", "IgnorePVPMountedWeaponryRestrictions"]);
});

test("un valore già presente nel file corretto non viene sovrascritto dalla copia legacy", () => {
  const migrated = migrateLegacyKeyLocations({
    GameUserSettings: { values: { ImplantSuicideCD: "300" }, sections: {} },
    Game: { values: { ImplantSuicideCD: "600" }, sections: {} },
  });
  assert.equal(migrated.GameUserSettings.values.ImplantSuicideCD, "300");
  assert.equal(migrated.Game.values.ImplantSuicideCD, undefined);
});

test("MaxPlayers nella vecchia sezione GameSession passa a [ARKSA.Launch] e RCONEnabled viene scartata", () => {
  const migrated = migrateLegacyKeyLocations({
    GameUserSettings: {
      values: { MaxPlayers: "3", RCONEnabled: "True", SessionName: "Ark" },
      sections: { MaxPlayers: "/Script/Engine.GameSession", SessionName: "SessionSettings" },
    },
    Game: { values: {}, sections: {} },
  });
  assert.deepEqual(migrated.GameUserSettings.values, { MaxPlayers: "3", SessionName: "Ark" });
  assert.deepEqual(migrated.GameUserSettings.sections, { MaxPlayers: "ARKSA.Launch", SessionName: "SessionSettings" });
});

test("la baseline delle chiavi gestite è allineata al file del catalogo", () => {
  const fileOf = new Map(ALL_GAME_SETTING_FIELDS.map((field) => [field.key.toLowerCase(), field.file]));
  for (const file of ["GameUserSettings", "Game"] as const) {
    for (const key of MANAGED_KEYS_BASELINE[file]) {
      const catalogFile = fileOf.get(key.toLowerCase());
      if (catalogFile) assert.equal(catalogFile, file, `${key} è in ${file} nella baseline ma in ${catalogFile} nel catalogo`);
    }
  }
});
