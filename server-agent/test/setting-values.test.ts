import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogRule } from "../src/shared/config-rules.js";

type Field = CatalogRule & { defaultValue: string | null };

const root = new URL("../../control-plane/pwa/src/", import.meta.url);
const { ALL_GAME_SETTING_FIELDS } = await import(new URL("gameSettingsSchema.ts", root).href) as {
  ALL_GAME_SETTING_FIELDS: Field[];
};
const { isModifiedSetting } = await import(new URL("gameSettingValues.ts", root).href) as {
  isModifiedSetting: (field: Field, value: string | undefined) => boolean;
};
const { valueError } = await import(new URL("configRules.ts", root).href) as {
  valueError: (rule: CatalogRule, value: string) => string | null;
};

function field(key: string): Field {
  const match = ALL_GAME_SETTING_FIELDS.find((candidate) => candidate.key === key);
  assert.ok(match, key);
  return match;
}

test("'Modificata' conta solo i valori diversi dal default", () => {
  const xp = field("XPMultiplier");
  assert.equal(isModifiedSetting(xp, undefined), false);
  assert.equal(isModifiedSetting(xp, ""), false);
  assert.equal(isModifiedSetting(xp, "   "), false);
  assert.equal(isModifiedSetting(xp, "1"), false, "uguale al default");
  assert.equal(isModifiedSetting(xp, "1.0"), false, "confronto numerico");
  assert.equal(isModifiedSetting(xp, "2"), true);

  assert.equal(isModifiedSetting(field("serverPVE"), "False"), false);
  assert.equal(isModifiedSetting(field("serverPVE"), "True"), true);
  assert.equal(isModifiedSetting(field("ServerPassword"), ""), false);
  assert.equal(isModifiedSetting(field("ServerPassword"), "x"), true);
  assert.equal(isModifiedSetting(field("MaxAlliancesPerTribe"), "3"), true, "default non documentato");
});

test("le descrizioni di riserva riguardano solo chiavi esistenti e coprono quasi tutto il catalogo", async () => {
  const { GAME_SETTING_HELP } = await import(new URL("gameSettingHelp.ts", root).href) as {
    GAME_SETTING_HELP: Record<string, string>;
  };
  const keys = new Set(ALL_GAME_SETTING_FIELDS.map((candidate) => candidate.key));
  for (const [key, help] of Object.entries(GAME_SETTING_HELP)) {
    assert.ok(keys.has(key), `descrizione per una chiave inesistente: ${key}`);
    assert.ok(help.trim().length >= 20 && help.endsWith("."), `descrizione troppo breve o senza punto: ${key}`);
  }
  const withoutHelp = ALL_GAME_SETTING_FIELDS.filter((candidate) => !(candidate as { help?: string }).help).map((f) => f.key).sort();
  // Volutamente senza testo: nessuna fonte ASA ne documenta il significato.
  const undocumented = [
    "MaxActiveCityOutposts", "MaxActiveOutposts", "MaxActiveResourceCaches", "MaxStructuresToProcess",
    "OutpostSigilRewardMultiplier", "FreezeReaperPregnancy", "YoungIceFoxDeathCooldown",
    "bDisableWirelessCrafting", "bDisableWirelessCraftingForDinos", "bDisableWirelessCraftingForPlayers",
    "bDisableWirelessCraftingForStructures", "bFlyerPlatformAllowUnalignedDinoBasing",
  ].sort();
  assert.deepEqual(withoutHelp, undocumented);
});

test("MultiHome e ExclusiveJoin restano nel catalogo ma nascosti salvo profili che li usano", () => {
  for (const key of ["MultiHome", "ExclusiveJoin"]) {
    assert.equal((field(key) as { legacy?: boolean }).legacy, true, key);
  }
});

test("i campi infrastrutturali non risultano mai modificati", () => {
  for (const key of ["ServerAdminPassword", "AdminListURL", "UpdateAllowedCheatersInterval", "RCONPort"]) {
    assert.equal(isModifiedSetting(field(key), "qualcosa"), false, key);
  }
});

test("la copia fra configurazioni può scartare i valori non validi con valueError", () => {
  assert.equal(valueError(field("XPMultiplier"), "2.5"), null);
  assert.equal(valueError(field("XPMultiplier"), "500"), null, "un moltiplicatore oltre lo slider si copia");
  assert.match(valueError(field("XPMultiplier"), "-1") ?? "", /inferiore al minimo/);
  assert.match(valueError(field("MaxPlayers"), "500") ?? "", /fuori dall'intervallo/);
  assert.match(valueError(field("MaxPlayers"), "abc") ?? "", /intero/);
  assert.match(valueError(field("serverPVE"), "si") ?? "", /True o False/);
  assert.match(valueError(field("ServerPlatform"), "PC+XBOX") ?? "", /non ammesso/);
});
