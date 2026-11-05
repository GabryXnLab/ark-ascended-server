import "./provision-env.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { config } from "../src/config.js";
import {
  installXaudio,
  markModsOnline,
  modsRequiringUpdate,
  primeBaseGameUpdate,
  updateBaseGame,
  updateBaseGameBeforeLaunch,
} from "../src/content-updates.js";

after(async () => {
  await fs.rm(config.modVersionsFile, { force: true });
  await fs.rm(config.arkInstallDir, { recursive: true, force: true });
});

test("una mod nuova o con versione diversa richiede aggiornamento", async () => {
  await fs.rm(config.modVersionsFile, { force: true });
  const initial = [{ id: 10, version: "file:1" }, { id: 20, version: null }];
  assert.deepEqual(await modsRequiringUpdate(initial), [10, 20]);

  await markModsOnline(initial);
  assert.deepEqual(await modsRequiringUpdate([{ id: 10, version: "file:1" }]), []);
  assert.deepEqual(await modsRequiringUpdate([{ id: 10, version: "file:2" }]), [10]);
});

test("SteamCMD deve certificare l'app update anche in mock", async () => {
  await updateBaseGame();
});

test("il pre-controllo al boot viene consumato una volta senza duplicare SteamCMD", async () => {
  let calls = 0;
  const runner = async () => {
    calls += 1;
    return {
      stdout: `Success! App '${config.arkAppId}' fully installed.`,
      stderr: "",
      code: 0,
    };
  };

  const primed = primeBaseGameUpdate(runner, 0);
  const consumed = updateBaseGameBeforeLaunch(runner, 0);
  await Promise.all([primed, consumed]);
  assert.equal(calls, 1);

  await updateBaseGameBeforeLaunch(runner, 0);
  assert.equal(calls, 2, "un lancio successivo deve ricontrollare gli aggiornamenti");
});

test("SteamCMD ritenta gli stati transitori e usa validate come fallback", async () => {
  const steamapps = `${config.arkInstallDir}/steamapps`;
  const manifest = `${steamapps}/appmanifest_${config.arkAppId}.acf`;
  const staging = `${steamapps}/downloading/${config.arkAppId}`;
  await fs.mkdir(staging, { recursive: true });
  await fs.writeFile(manifest, "manifest-obsoleto", "utf8");
  await fs.writeFile(`${staging}/chunk`, "parziale", "utf8");
  const calls: string[][] = [];
  await updateBaseGame(async (_cmd, args) => {
    calls.push(args);
    if (calls.length < 3) return { stdout: "", stderr: "App state is 0x6", code: 8 };
    return { stdout: `Success! App '${config.arkAppId}' fully installed.`, stderr: "", code: 0 };
  }, 0);

  assert.equal(calls.length, 3);
  assert.equal(calls.at(0)?.includes("validate"), false);
  assert.equal(calls.at(1)?.includes("validate"), false);
  assert.equal(calls.at(2)?.includes("validate"), true);
  assert.equal(await fs.readFile(`${manifest}.arksa-stale`, "utf8"), "manifest-obsoleto");
  await assert.rejects(fs.access(manifest), { code: "ENOENT" });
  await assert.rejects(fs.access(staging), { code: "ENOENT" });
});

test("una build già aggiornata è certificata senza retry né validate", async () => {
  const calls: string[][] = [];
  await updateBaseGame(async (_cmd, args) => {
    calls.push(args);
    return { stdout: `Success! App '${config.arkAppId}' already up to date.`, stderr: "", code: 0 };
  }, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.includes("validate"), false);
});

test("SteamCMD non certificato blocca l'avvio anche dopo i retry", async () => {
  await assert.rejects(
    updateBaseGame(async () => ({ stdout: "", stderr: "App state is 0x6", code: 8 }), 0),
    /dopo 3 tentativi/,
  );
});

test("XAudio2 viene installata dallo script con la directory Win64", async () => {
  const calls: string[][] = [];
  await installXaudio("/data/ark/Win64", async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { stdout: "", stderr: "", code: 0 };
  });
  assert.deepEqual(calls, [[config.xaudioInstallScript, "/data/ark/Win64"]]);
  await assert.rejects(
    installXaudio("/x", async () => ({ stdout: "", stderr: "hash inatteso", code: 1 })),
    /hash inatteso/,
  );
});
