import "./env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { replaceManagedIni } from "../src/ini.js";

test.afterEach(async () => {
  for (const file of [config.gusIni, config.gameIni]) {
    await fs.rm(file, { force: true });
    await fs.rm(`${file}.arksa-managed.json`, { force: true });
  }
});

test("replaceManagedIni rimuove le chiavi gestite solo nella loro sezione", async () => {
  await fs.writeFile(
    config.gusIni,
    [
      "[ModX]", "Message=keepme", "Duration=9",
      "[/Script/Engine.GameSession]", "MaxPlayers=70",
      "[MessageOfTheDay]", "Message=vecchio", "Duration=3",
      "",
    ].join("\n"),
    "utf8",
  );
  await replaceManagedIni("GameUserSettings", {
    values: { Message: "Benvenuti" },
    sections: { Message: "MessageOfTheDay" },
    managedKeys: ["Message", "Duration", "MaxPlayers"],
  });
  const content = await fs.readFile(config.gusIni, "utf8");
  assert.match(content, /\[ModX\]\nMessage=keepme\nDuration=9/);
  assert.match(content, /\[\/Script\/Engine\.GameSession\]\nMaxPlayers=70/);
  assert.doesNotMatch(content, /Message=vecchio|Duration=3/);
  assert.match(content, /\[MessageOfTheDay\]\nMessage=Benvenuti/);
});

test("il raw di una mod può riusare il nome di un campo grafico in un'altra sezione", async () => {
  await replaceManagedIni("GameUserSettings", {
    values: { Duration: "20" },
    sections: { Duration: "MessageOfTheDay" },
    raw: "[ModY]\nDuration=5",
    managedKeys: ["Duration"],
  });
  const content = await fs.readFile(config.gusIni, "utf8");
  assert.match(content, /\[MessageOfTheDay\]\nDuration=20/);
  assert.match(content, /\[ModY\]\nDuration=5/);

  await replaceManagedIni("GameUserSettings", { values: {}, sections: {}, raw: "", managedKeys: ["Duration"] });
  assert.doesNotMatch(await fs.readFile(config.gusIni, "utf8"), /Duration=/);
});

test("un sidecar senza sezioni continua a ripulire ovunque", async () => {
  await fs.writeFile(config.gusIni, "[Vecchia]\nAudit.Option=True\n", "utf8");
  await fs.writeFile(`${config.gusIni}.arksa-managed.json`, JSON.stringify({ keys: ["Audit.Option"] }), "utf8");
  await replaceManagedIni("GameUserSettings", { values: {}, sections: {}, raw: "" });
  assert.doesNotMatch(await fs.readFile(config.gusIni, "utf8"), /Audit\.Option/);
});

test("BanListURL viene scritta fra virgolette senza raddoppiarle", async () => {
  await replaceManagedIni("GameUserSettings", { values: { BanListURL: "https://example.org/ban.txt" }, sections: {} });
  assert.match(await fs.readFile(config.gusIni, "utf8"), /^BanListURL="https:\/\/example\.org\/ban\.txt"$/m);
  await replaceManagedIni("GameUserSettings", { values: { BanListURL: '"https://example.org/ban.txt"' }, sections: {} });
  assert.match(await fs.readFile(config.gusIni, "utf8"), /^BanListURL="https:\/\/example\.org\/ban\.txt"$/m);
});

test("la scrittura è atomica e conserva i permessi esistenti", async () => {
  await fs.mkdir(path.dirname(config.gusIni), { recursive: true });
  await fs.writeFile(config.gusIni, "[ServerSettings]\nXPMultiplier=9\n", { encoding: "utf8", mode: 0o600 });
  await fs.chmod(config.gusIni, 0o600);
  await replaceManagedIni("GameUserSettings", { values: { XPMultiplier: "2" }, sections: {}, managedKeys: ["XPMultiplier"] });
  assert.equal((await fs.stat(config.gusIni)).mode & 0o777, 0o600);

  await fs.rm(config.gusIni);
  await replaceManagedIni("GameUserSettings", { values: { XPMultiplier: "2" }, sections: {} });
  assert.equal((await fs.stat(config.gusIni)).mode & 0o777, 0o600, "GameUserSettings.ini nuovo nasce riservato");

  const leftovers = (await fs.readdir(path.dirname(config.gusIni))).filter((name) => name.startsWith(`${path.basename(config.gusIni)}.arksa-`) && !name.endsWith(".json"));
  assert.deepEqual(leftovers, []);
});
