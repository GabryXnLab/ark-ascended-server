import "./env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { config } from "../src/config.js";
import { readIni, replaceManagedIni, synchronizeInfrastructureGameUserSettings } from "../src/ini.js";
import { parseLaunchArgs } from "../src/launch-options.js";

test.afterEach(async () => {
  await fs.rm(config.gusIni, { force: true });
  await fs.rm(`${config.gusIni}.arksa-managed.json`, { force: true });
});

test("RCONPort è infrastrutturale: rifiutata nei valori e nel raw, nascosta in lettura", async () => {
  await assert.rejects(
    replaceManagedIni("GameUserSettings", { values: { RCONPort: "27099" }, sections: {} }),
    /RCONPort.*infrastruttura/i,
  );
  await assert.rejects(
    replaceManagedIni("GameUserSettings", { values: {}, sections: {}, raw: "rconport=27099" }),
    /RCONPort.*infrastruttura/i,
  );
  await fs.writeFile(config.gusIni, "[ServerSettings]\nRCONPort=27099\nXPMultiplier=2\n", "utf8");
  assert.deepEqual(await readIni("GameUserSettings"), { XPMultiplier: "2" });
});

test("la sincronizzazione infrastrutturale riallinea RCONPort all'env", async () => {
  await fs.writeFile(config.gusIni, "[ServerSettings]\nRCONPort=27099\nXPMultiplier=2\n", "utf8");
  await synchronizeInfrastructureGameUserSettings();
  const content = await fs.readFile(config.gusIni, "utf8");
  assert.equal((content.match(/^RCONPort=/gim) ?? []).length, 1);
  assert.match(content, new RegExp(`^RCONPort=${config.rconPort}$`, "m"));
});

test("gli argomenti CLI che duplicano URL di avvio, porte e credenziali sono riservati", () => {
  for (const arg of [
    "-QueryPort=1234", "-Port=7778", "-RCONPort=1", "-RCONEnabled=False", "-AltSaveDirectoryName=x",
    "-ServerAdminPassword=zz", "-ServerPassword=x", "-SpectatorPassword=x", "-SessionName=x", "-MaxPlayers=9",
    "-queryport 1234", "--Port=1",
  ]) {
    assert.throws(() => parseLaunchArgs(arg), /gestito da un campo dedicato/, arg);
  }
  assert.deepEqual(parseLaunchArgs("-NoBattlEye\n-culture=it"), ["-NoBattlEye", "-culture=it"]);
});
