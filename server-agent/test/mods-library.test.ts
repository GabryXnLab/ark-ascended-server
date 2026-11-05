// Verifica lo scan reale del filesystem (mode "live", non mock) su una cartella
// temporanea che imita <arkInstallDir>/ShooterGame/.../Mods/<cartella>/ — path
// verificato dal vivo (vedi commento in testa a src/mods-library.ts).

import "./mods-env.js";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { config } from "../src/config.js";
import { listInstalledMods, uninstallMod } from "../src/mods-library.js";

const tmpBase = config.arkInstallDir;
const modsDir = path.join(tmpBase, "ShooterGame/Binaries/Win64/ShooterGame/Mods");

test.after(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true });
});

test("listInstalledMods ritorna [] se la cartella base non esiste ancora", async () => {
  const mods = await listInstalledMods();
  assert.deepEqual(mods, []);
});

test("listInstalledMods legge il layout nativo Mods/83374/<ModID>_<FileID> senza esporre la cartella del gioco", async () => {
  const game = path.join(modsDir, "83374");
  await fs.mkdir(path.join(game, "988598_6608254", "sub"), { recursive: true });
  await fs.writeFile(path.join(game, "988598_6608254", "a.pak"), Buffer.alloc(1024));
  await fs.writeFile(path.join(game, "988598_6608254", "sub", "b.pak"), Buffer.alloc(256));
  // Versione precedente della stessa mod: sommata, non una seconda voce.
  await fs.mkdir(path.join(game, "988598_6000000"), { recursive: true });
  await fs.writeFile(path.join(game, "988598_6000000", "old.pak"), Buffer.alloc(512));
  await fs.mkdir(path.join(game, "929110_7738786"), { recursive: true });
  await fs.writeFile(path.join(game, "929110_7738786", "c.pak"), Buffer.alloc(64));
  // Staging dell'updater e cartelle non numeriche: ignorati.
  await fs.mkdir(path.join(game, ".temp"), { recursive: true });
  await fs.mkdir(path.join(modsDir, ".temp"), { recursive: true });

  const mods = await listInstalledMods();
  assert.deepEqual(mods.map((mod) => mod.id), [929110, 988598]);
  const astraeos = mods.find((mod) => mod.id === 988598);
  assert.ok(astraeos);
  assert.equal(astraeos.sizeBytes, 1024 + 256 + 512);
  assert.ok(!Number.isNaN(Date.parse(astraeos.installedAt)));
});

test("uninstallMod rimuove tutte le versioni della sola mod indicata ed è idempotente", async () => {
  await uninstallMod(988598);
  const mods = await listInstalledMods();
  assert.deepEqual(mods.map((mod) => mod.id), [929110]);
  await fs.access(path.join(modsDir, "83374", "929110_7738786"));

  // Seconda chiamata su una mod già assente: non deve lanciare.
  await assert.doesNotReject(() => uninstallMod(988598));
});

test("uninstallMod con l'ID della cartella del gioco non cancella le mod", async () => {
  await uninstallMod(83374);
  const mods = await listInstalledMods();
  assert.deepEqual(mods.map((mod) => mod.id), [929110]);
});
