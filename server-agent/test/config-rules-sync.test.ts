import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import type { CatalogRule, IniFile, IniOverrideSet } from "../src/shared/config-rules.js";
import { validateConfigSettings } from "../src/shared/config-rules.js";

interface CatalogField extends CatalogRule {
  defaultValue: string | null;
}

const root = new URL("../../", import.meta.url);
const { expectedGeneratedFiles } = await import(
  new URL("scripts/sync-config-rules.mts", root).href
) as { expectedGeneratedFiles: () => Promise<Record<string, string>> };
const { ALL_GAME_SETTING_FIELDS } = await import(
  new URL("control-plane/pwa/src/gameSettingsSchema.ts", root).href
) as { ALL_GAME_SETTING_FIELDS: CatalogField[] };

test("le copie backend/agent delle regole di validazione coincidono con la sorgente PWA", async () => {
  for (const [path, expected] of Object.entries(await expectedGeneratedFiles())) {
    const actual = await fs.readFile(new URL(path, root), "utf8");
    assert.equal(actual, expected, `${path} non sincronizzato: dalla cartella server-agent esegui 'node --import tsx ../scripts/sync-config-rules.mts'`);
  }
});

test("la configurazione costruita dal catalogo con i default ASA supera la validazione di salvataggio", () => {
  const sets: Record<IniFile, IniOverrideSet> = {
    GameUserSettings: { values: {}, sections: {}, raw: "", managedKeys: [] },
    Game: { values: {}, sections: {}, raw: "", managedKeys: [] },
  };
  for (const field of ALL_GAME_SETTING_FIELDS) {
    const set = sets[field.file];
    set.managedKeys!.push(field.key);
    if (field.infrastructureManaged || field.defaultValue === null || field.defaultValue === "") continue;
    set.values[field.key] = field.defaultValue;
    if (field.section) set.sections[field.key] = field.section;
  }
  const errors = validateConfigSettings(
    { gus: sets.GameUserSettings, game: sets.Game, launchArgs: "" },
    ALL_GAME_SETTING_FIELDS,
  );
  assert.deepEqual(errors, []);
});
