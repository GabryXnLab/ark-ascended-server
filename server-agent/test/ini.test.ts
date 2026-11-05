import "./env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { config } from "../src/config.js";
import {
  readIni,
  replaceManagedIni,
  synchronizeInfrastructureGameUserSettings,
} from "../src/ini.js";
import { parseLaunchArgs, replaceLaunchArgs } from "../src/launch-options.js";

interface CatalogField {
  key: string;
  file: "GameUserSettings" | "Game";
  section?: string;
  type: "bool" | "float" | "int" | "string" | "password";
  defaultValue: string | null;
  placeholder: string;
  min?: number;
  max?: number;
  sliderMax?: number;
  step?: number;
  infrastructureManaged?: boolean;
}

test.after(async () => {
  await fs.rm(config.gusIni, { force: true });
  await fs.rm(config.gameIni, { force: true });
  await fs.rm(`${config.gusIni}.arksa-managed.json`, { force: true });
  await fs.rm(`${config.gameIni}.arksa-managed.json`, { force: true });
  await fs.rm(config.launchArgsFile, { force: true });
});

test("readIni ritorna oggetto vuoto se il file non esiste", async () => {
  const values = await readIni("Game");
  assert.deepEqual(values, {});
});

test("replaceManagedIni rimuove valori del profilo precedente ma preserva righe estranee", async () => {
  await fs.writeFile(config.gusIni, "[ServerSettings]\nModSetting=keep\nXPMultiplier=99\n", "utf8");
  await replaceManagedIni("GameUserSettings", {
    values: { XPMultiplier: "2.0", TamingSpeedMultiplier: "4.0" },
    sections: {},
    managedKeys: ["XPMultiplier", "TamingSpeedMultiplier", "HarvestAmountMultiplier"],
  });
  await replaceManagedIni("GameUserSettings", {
    values: { HarvestAmountMultiplier: "3.0" },
    sections: {},
    managedKeys: ["XPMultiplier", "TamingSpeedMultiplier", "HarvestAmountMultiplier"],
  });
  const content = await fs.readFile(config.gusIni, "utf8");
  assert.match(content, /ModSetting=keep/);
  assert.doesNotMatch(content, /XPMultiplier=/);
  assert.doesNotMatch(content, /TamingSpeedMultiplier=/);
  assert.equal((content.match(/HarvestAmountMultiplier=/g) ?? []).length, 1);
});

test("replaceManagedIni applica sezioni, chiavi ripetute raw e reset completo", async () => {
  await replaceManagedIni("GameUserSettings", {
    values: { SessionName: "Test live", MaxPlayers: "31" },
    sections: { SessionName: "SessionSettings", MaxPlayers: "ARKSA.Launch" },
    raw: "[MyMod]\nEnabled=True",
    managedKeys: ["SessionName", "MaxPlayers"],
  });
  const gus = await fs.readFile(config.gusIni, "utf8");
  assert.match(gus, /\[SessionSettings\]\nSessionName=Test live/);
  assert.match(gus, /\[ARKSA\.Launch\]\nMaxPlayers=31/);
  assert.match(gus, /\[MyMod\]\nEnabled=True/);

  await replaceManagedIni("Game", {
    values: { "PerLevelStatsMultiplier_Player[7]": "5.0" },
    sections: {},
    raw: "OverridePlayerLevelEngramPoints=8\nOverridePlayerLevelEngramPoints=10",
    managedKeys: ["PerLevelStatsMultiplier_Player[7]"],
  });
  const game = await fs.readFile(config.gameIni, "utf8");
  assert.equal((game.match(/OverridePlayerLevelEngramPoints=/g) ?? []).length, 2);

  await replaceManagedIni("Game", { values: {}, sections: {}, raw: "", managedKeys: ["PerLevelStatsMultiplier_Player[7]"] });
  const reset = await fs.readFile(config.gameIni, "utf8");
  assert.doesNotMatch(reset, /PerLevelStatsMultiplier_Player/);
  assert.doesNotMatch(reset, /OverridePlayerLevelEngramPoints/);
});

test("replaceManagedIni ripulisce operatori array e chiavi mod anche se ASA rimuove i marker", async () => {
  await replaceManagedIni("GameUserSettings", {
    values: {},
    sections: {},
    raw: "[AuditMod]\n+Rules=(Enabled=True)\nAudit.Option=True",
  });
  const rewrittenByAsa = (await fs.readFile(config.gusIni, "utf8"))
    .split(/\r?\n/)
    .filter((line) => !line.includes("ARKSA MANAGED CONFIG"))
    .join("\n");
  await fs.writeFile(config.gusIni, rewrittenByAsa, "utf8");

  await replaceManagedIni("GameUserSettings", { values: {}, sections: {}, raw: "" });
  const reset = await fs.readFile(config.gusIni, "utf8");
  assert.doesNotMatch(reset, /\+Rules=/);
  assert.doesNotMatch(reset, /Audit\.Option=/);
});

test("replaceManagedIni rifiuta una direttiva raw duplicata dal form", async () => {
  await assert.rejects(
    replaceManagedIni("Game", {
      values: { BabyMatureSpeedMultiplier: "3.0" },
      sections: {},
      raw: "BabyMatureSpeedMultiplier=9.0",
    }),
    /duplica un campo/,
  );
});

test("replaceManagedIni rifiuta injection multilinea nei campi scalari", async () => {
  await assert.rejects(
    replaceManagedIni("GameUserSettings", {
      values: { SessionName: "Server valido\nNoTransferFromFiltering=True" },
      sections: { SessionName: "SessionSettings" },
    }),
    /non può contenere nuove righe/,
  );
  await assert.rejects(
    replaceManagedIni("GameUserSettings", {
      values: { SessionName: "Server valido" },
      sections: { SessionName: "SessionSettings]\n[ARKSA.Launch" },
    }),
    /Sezione INI non valida/,
  );
});

test("le impostazioni amministrative sono riservate all'infrastruttura", async () => {
  await assert.rejects(
    replaceManagedIni("GameUserSettings", {
      values: { ServerAdminPassword: "secret" },
      sections: {},
    }),
    /gestita dall'infrastruttura/,
  );
  await assert.rejects(
    replaceManagedIni("GameUserSettings", {
      values: {},
      sections: {},
      raw: "+serveradminpassword=secret",
    }),
    /gestita dall'infrastruttura/,
  );
  await assert.rejects(
    replaceManagedIni("GameUserSettings", {
      values: { AdminListURL: "https://example.invalid/admins.txt" },
      sections: {},
    }),
    /gestita dall'infrastruttura/,
  );

  await fs.writeFile(
    config.gusIni,
    "[ServerSettings]\nServerAdminPassword=legacy-secret\n+ServerAdminPassword=legacy-array-secret\nAdminListURL=https://example.invalid/admins.txt\nUpdateAllowedCheatersInterval=600\nXPMultiplier=2\n",
    "utf8",
  );
  assert.deepEqual(await readIni("GameUserSettings"), { XPMultiplier: "2" });
});

test("riallinea atomicamente le impostazioni amministrative runtime", async () => {
  await fs.writeFile(
    config.gusIni,
    "[ServerSettings]\nServerAdminPassword=legacy\n+serveradminpassword=duplicate\nAdminListURL=https://example.invalid/admins.txt\nUpdateAllowedCheatersInterval=600\nXPMultiplier=2\n",
    { encoding: "utf8", mode: 0o640 },
  );
  await synchronizeInfrastructureGameUserSettings();
  const first = await fs.readFile(config.gusIni, "utf8");
  assert.equal((first.match(/^[+-]?ServerAdminPassword=/gim) ?? []).length, 1);
  assert.match(first, new RegExp(`^ServerAdminPassword=${config.rconPassword}$`, "m"));
  assert.match(first, new RegExp(`^AdminListURL="${config.adminListUrl}"$`, "m"));
  assert.match(first, new RegExp(`^UpdateAllowedCheatersInterval=${config.adminListRefreshSeconds}$`, "m"));
  assert.doesNotMatch(first, /legacy|duplicate/);
  assert.doesNotMatch(first, /example\.invalid|=600/);
  assert.deepEqual(await readIni("GameUserSettings"), { XPMultiplier: "2" });
  assert.equal((await fs.stat(config.gusIni)).mode & 0o777, 0o600);

  await synchronizeInfrastructureGameUserSettings();
  assert.equal(await fs.readFile(config.gusIni, "utf8"), first);
});

test("l'intero catalogo PWA viene serializzato nel file e nella sezione corretti", async () => {
  // Import dinamico calcolato: il test integra i due pacchetti, ma la build
  // isolata dell'agent non deve trascinare sorgenti PWA fuori dal suo rootDir.
  const catalogUrl = new URL("../../control-plane/pwa/src/gameSettingsSchema.ts", import.meta.url).href;
  const catalogModule = await import(catalogUrl) as { ALL_GAME_SETTING_FIELDS: CatalogField[] };
  const { ALL_GAME_SETTING_FIELDS } = catalogModule;
  const unique = new Set(ALL_GAME_SETTING_FIELDS.map((field) => field.key.toLowerCase()));
  assert.equal(unique.size, ALL_GAME_SETTING_FIELDS.length, "chiavi duplicate nel catalogo");
  assert.equal(ALL_GAME_SETTING_FIELDS.length, 422, "copertura catalogo ASA inattesa");

  for (const field of ALL_GAME_SETTING_FIELDS) {
    assert.notEqual(field.defaultValue, undefined, `default assente per ${field.key}`);
    assert.equal(
      field.placeholder,
      field.defaultValue === null ? "(non impostato)" : field.defaultValue === "" ? "(vuoto)" : field.defaultValue,
      `placeholder non allineato al default per ${field.key}`,
    );
    if (field.type === "bool") {
      assert.ok(field.defaultValue === "True" || field.defaultValue === "False", `default booleano non valido per ${field.key}`);
    }
    if (field.type !== "int" && field.type !== "float") continue;
    assert.equal(typeof field.min, "number", `min assente per ${field.key}`);
    // I moltiplicatori non hanno limite superiore di validazione: il profilo 0–6
    // dell'interfaccia host ARK vale solo per lo slider.
    const sliderMax = field.sliderMax ?? field.max;
    assert.equal(typeof sliderMax, "number", `estremo dello slider assente per ${field.key}`);
    assert.ok((field.min as number) < (sliderMax as number), `range non valido per ${field.key}`);
    assert.ok((field.step ?? 0) > 0, `step non valido per ${field.key}`);
    if (field.defaultValue !== null) {
      const gameDefault = Number(field.defaultValue);
      assert.ok(Number.isFinite(gameDefault), `default numerico non valido per ${field.key}`);
      assert.ok(gameDefault >= (field.min as number) && gameDefault <= (sliderMax as number), `default fuori range per ${field.key}`);
    }
    if (field.key.includes("Multiplier")) {
      assert.equal(field.max, undefined, `moltiplicatore con limite di validazione per ${field.key}`);
      assert.ok((field.sliderMax as number) <= 6, `slider moltiplicatore fuori profilo ARK per ${field.key}`);
    } else if (field.key !== "OverrideOfficialDifficulty") {
      assert.equal(field.sliderMax, undefined, `sliderMax inatteso per ${field.key}`);
    }
  }

  for (const file of ["GameUserSettings", "Game"] as const) {
    const fields = ALL_GAME_SETTING_FIELDS.filter((field) => field.file === file && !field.infrastructureManaged);
    const values = Object.fromEntries(fields.map((field, index) => [
      field.key,
      field.type === "bool" ? "True" : field.type === "int" ? "7" : field.type === "float" ? "1.25" : `audit-${index}`,
    ]));
    const sections = Object.fromEntries(fields.filter((field) => field.section).map((field) => [field.key, field.section as string]));
    await replaceManagedIni(file, { values, sections, managedKeys: fields.map((field) => field.key) });

    const content = await fs.readFile(file === "GameUserSettings" ? config.gusIni : config.gameIni, "utf8");
    let currentSection = "";
    const actualSections = new Map<string, string>();
    for (const line of content.split(/\r?\n/)) {
      const header = line.match(/^\[([^\]]+)\]$/);
      if (header?.[1]) currentSection = header[1];
      const equals = line.indexOf("=");
      if (equals > 0) actualSections.set(line.slice(0, equals), currentSection);
    }
    const defaultSection = file === "GameUserSettings" ? "ServerSettings" : "/script/shootergame.shootergamemode";
    for (const field of fields) {
      assert.equal(actualSections.get(field.key)?.toLowerCase(), (field.section ?? defaultSection).toLowerCase(), field.key);
      assert.match(content, new RegExp(`^${field.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`, "m"), field.key);
    }
  }
});

test("argomenti ASA avanzati sono per-riga, persistiti e senza word splitting", async () => {
  const args = parseLaunchArgs("# commento\n-culture=it\n-CustomNotificationURL=https://example.invalid/hook path");
  assert.deepEqual(args, ["-culture=it", "-CustomNotificationURL=https://example.invalid/hook path"]);
  await replaceLaunchArgs(args.join("\n"));
  assert.equal(await fs.readFile(config.launchArgsFile, "utf8"), `${args.join("\n")}\n`);
});

test("argomenti ASA gestiti dal form/infrastruttura non possono essere duplicati", () => {
  assert.throws(() => parseLaunchArgs("-WinLiveMaxPlayers=99"), /gestito da un campo dedicato/);
  assert.throws(() => parseLaunchArgs("-NoTransferFromFiltering"), /gestito da un campo dedicato/);
  assert.throws(() => parseLaunchArgs("culture=it"), /deve iniziare/);
});
