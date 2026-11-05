import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSaveArchive,
  isSaveFile,
  listSaveFiles,
  profileSaveDir,
  restoreSaveArchive,
  validateSaveArchive,
} from "../src/save-archive.js";

const PROFILE = "3a3bcf60-e467-4de0-8992-eb715fbcbd51";
const OTHER = "00000000-0000-4000-8000-202608290004";

async function put(root: string, rel: string, content = rel): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content);
}

/** Saved/ con il layout di ASA: Config/ con segreti, Logs/, crash, due profili. */
async function savedFixture(): Promise<string> {
  const saved = await mkdtemp(path.join(tmpdir(), "arksa-saved-"));
  await put(saved, "Config/WindowsServer/GameUserSettings.ini", "ServerAdminPassword=segreta\n");
  await put(saved, "Config/WindowsServer/Game.ini");
  await put(saved, "Logs/ShooterGame.log");
  await put(saved, "Crashes/UECC-Windows-1/CrashContext.runtime-xml");
  await put(saved, "AllowedCheaterAccountIDs.txt");
  await put(saved, "clusters/cluster-a/0002abc");
  await put(saved, `${PROFILE}/Astraeos_WP/Astraeos_WP.ark`, "mondo-attuale");
  await put(saved, `${PROFILE}/Astraeos_WP/Astraeos_WP_29.09.2026_21.00.00.ark`, "rotazione");
  await put(saved, `${PROFILE}/Astraeos_WP/Astraeos_WP.corrupt-20260825T143529Z.ark`, "corrotto");
  await put(saved, `${PROFILE}/Astraeos_WP/0002a1b2c3.arkprofile`, "giocatore");
  await put(saved, `${PROFILE}/Astraeos_WP/1234567890.arktribe`, "tribù");
  await put(saved, `${PROFILE}/Astraeos_WP/1234567890.arktributetribe`, "tribù-tributo");
  await put(saved, `${PROFILE}/Astraeos_WP/0002a1b2c3.profilebak`, "vecchio");
  await put(saved, `${OTHER}/Astraeos_WP/Astraeos_WP.ark`, "mondo-altro-profilo");
  return saved;
}

function tarList(tarball: string): string[] {
  return execFileSync("tar", ["--zstd", "-tf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean);
}

test("isSaveFile ammette solo mondo, giocatori e tribù", () => {
  assert.equal(isSaveFile("Astraeos_WP/Astraeos_WP.ark"), true);
  assert.equal(isSaveFile("Astraeos_WP/0002a1b2c3.arkprofile"), true);
  assert.equal(isSaveFile("Astraeos_WP/1.arktribe"), true);
  assert.equal(isSaveFile("Astraeos_WP/1.arktributetribe"), true);
  assert.equal(isSaveFile("Astraeos_WP.ark"), true);
  assert.equal(isSaveFile("Astraeos_WP/Astraeos_WP_29.09.2026_21.00.00.ark"), false);
  assert.equal(isSaveFile("Astraeos_WP/Astraeos_WP.corrupt-20260825T143529Z.ark"), false);
  assert.equal(isSaveFile("Config/WindowsServer/GameUserSettings.ini"), false);
  assert.equal(isSaveFile("Logs/ShooterGame.log"), false);
  assert.equal(isSaveFile("../x/Astraeos_WP.ark"), false);
  assert.equal(isSaveFile("/abs/Astraeos_WP.ark"), false);
  assert.equal(isSaveFile("a\\b.ark"), false);
});

test("profileSaveDir rifiuta id che uscirebbero dalla cartella Saved", () => {
  assert.equal(profileSaveDir("/s", PROFILE), path.join("/s", PROFILE));
  for (const bad of ["", ".", "..", "../x", "a/b", ".restore-x", "Config/.."]) {
    assert.throws(() => profileSaveDir("/s", bad), /profileId non valido/);
  }
});

test("listSaveFiles non segue i link simbolici", async () => {
  const saved = await savedFixture();
  try {
    const dir = path.join(saved, PROFILE);
    await symlink(path.join(saved, "Config"), path.join(dir, "Config"));
    await symlink(path.join(saved, OTHER, "Astraeos_WP", "Astraeos_WP.ark"), path.join(dir, "altro.ark"));
    const { included, excluded } = await listSaveFiles(dir);
    assert.ok(!included.some((f) => f.startsWith("Config") || f === "altro.ark"));
    assert.ok(excluded.includes("Config") && excluded.includes("altro.ark"));
  } finally {
    await rm(saved, { recursive: true, force: true });
  }
});

test("createSaveArchive include solo i file di salvataggio del profilo", async () => {
  const saved = await savedFixture();
  const tarball = path.join(saved, "..", `${path.basename(saved)}.tar.zst`);
  try {
    const files = await createSaveArchive(path.join(saved, PROFILE), tarball);
    const expected = [
      "Astraeos_WP/0002a1b2c3.arkprofile",
      "Astraeos_WP/1234567890.arktribe",
      "Astraeos_WP/1234567890.arktributetribe",
      "Astraeos_WP/Astraeos_WP.ark",
    ];
    assert.deepEqual(files.included, expected);
    assert.deepEqual(tarList(tarball), expected);
    assert.deepEqual(files.excluded, [
      "Astraeos_WP/0002a1b2c3.profilebak",
      "Astraeos_WP/Astraeos_WP.corrupt-20260825T143529Z.ark",
      "Astraeos_WP/Astraeos_WP_29.09.2026_21.00.00.ark",
    ]);
    assert.deepEqual(await validateSaveArchive(tarball), expected);
  } finally {
    await rm(saved, { recursive: true, force: true });
    await rm(tarball, { force: true });
  }
});

test("createSaveArchive senza mondo non produce un archivio da caricare", async () => {
  const saved = await savedFixture();
  const tarball = path.join(saved, "..", `${path.basename(saved)}.tar.zst`);
  try {
    await rm(path.join(saved, PROFILE, "Astraeos_WP", "Astraeos_WP.ark"));
    await assert.rejects(createSaveArchive(path.join(saved, PROFILE), tarball), /nessun mondo/);
    await assert.rejects(createSaveArchive(path.join(saved, "assente"), tarball));
  } finally {
    await rm(saved, { recursive: true, force: true });
    await rm(tarball, { force: true });
  }
});

test("restoreSaveArchive sostituisce solo la cartella del profilo target", async () => {
  const source = await savedFixture();
  const target = await savedFixture();
  const tarball = path.join(source, "..", `${path.basename(source)}.tar.zst`);
  try {
    await writeFile(path.join(source, PROFILE, "Astraeos_WP", "Astraeos_WP.ark"), "mondo-dal-backup");
    await createSaveArchive(path.join(source, PROFILE), tarball);
    await writeFile(path.join(target, "Config/WindowsServer/GameUserSettings.ini"), "ServerAdminPassword=locale\n");
    await put(target, `${PROFILE}/Astraeos_WP/9999.arkprofile`, "giocatore-da-rimuovere");

    const restored = await restoreSaveArchive(tarball, target, PROFILE);
    assert.equal(restored.length, 4);

    const world = path.join(target, PROFILE, "Astraeos_WP", "Astraeos_WP.ark");
    assert.equal(await readFile(world, "utf8"), "mondo-dal-backup");
    assert.deepEqual((await listSaveFiles(path.join(target, PROFILE))).excluded, []);
    await assert.rejects(readFile(path.join(target, PROFILE, "Astraeos_WP", "9999.arkprofile")));
    assert.equal(await readFile(path.join(target, "Config/WindowsServer/GameUserSettings.ini"), "utf8"), "ServerAdminPassword=locale\n");
    assert.equal(await readFile(path.join(target, OTHER, "Astraeos_WP", "Astraeos_WP.ark"), "utf8"), "mondo-altro-profilo");
    assert.equal(await readFile(path.join(target, "Logs/ShooterGame.log"), "utf8"), "Logs/ShooterGame.log");
    assert.ok(!(await readdir(target)).some((name) => name.startsWith(".")));
  } finally {
    for (const p of [source, target, tarball]) await rm(p, { recursive: true, force: true });
  }
});

test("restoreSaveArchive ripristina su un profilo con id diverso o assente", async () => {
  const source = await savedFixture();
  const target = await mkdtemp(path.join(tmpdir(), "arksa-saved-empty-"));
  const tarball = path.join(source, "..", `${path.basename(source)}.tar.zst`);
  try {
    await createSaveArchive(path.join(source, PROFILE), tarball);
    await restoreSaveArchive(tarball, target, "nuovo-profilo");
    assert.equal(await readFile(path.join(target, "nuovo-profilo", "Astraeos_WP", "Astraeos_WP.ark"), "utf8"), "mondo-attuale");
    assert.deepEqual(await readdir(target), ["nuovo-profilo"]);
  } finally {
    for (const p of [source, target, tarball]) await rm(p, { recursive: true, force: true });
  }
});

test("restoreSaveArchive rifiuta archivi con Config, link o senza mondo e lascia il profilo intatto", async () => {
  const saved = await savedFixture();
  const work = await mkdtemp(path.join(tmpdir(), "arksa-evil-"));
  const world = path.join(saved, PROFILE, "Astraeos_WP", "Astraeos_WP.ark");
  try {
    const cases: Array<[string, string[]]> = [];

    await put(work, "a/Config/WindowsServer/GameUserSettings.ini", "ServerAdminPassword=x");
    await put(work, "a/Astraeos_WP/Astraeos_WP.ark");
    cases.push(["a", ["Astraeos_WP/Astraeos_WP.ark", "Config/WindowsServer/GameUserSettings.ini"]]);

    await mkdir(path.join(work, "b", "Astraeos_WP"), { recursive: true });
    await symlink("/etc/passwd", path.join(work, "b", "Astraeos_WP", "Astraeos_WP.ark"));
    cases.push(["b", ["Astraeos_WP/Astraeos_WP.ark"]]);

    await put(work, "c/Astraeos_WP/0002a1b2c3.arkprofile");
    cases.push(["c", ["Astraeos_WP/0002a1b2c3.arkprofile"]]);

    for (const [dir, members] of cases) {
      const tarball = path.join(work, `${dir}.tar.zst`);
      execFileSync("tar", ["--zstd", "-cf", tarball, "-C", path.join(work, dir), ...members]);
      await assert.rejects(restoreSaveArchive(tarball, saved, PROFILE), /non ammesso|non regolare|senza mondo/, dir);
      assert.equal(await readFile(world, "utf8"), "mondo-attuale", dir);
    }

    const traversal = path.join(work, "d.tar.zst");
    execFileSync("tar", ["--zstd", "-cf", traversal, "-C", work, "--transform", "s,^,../,", "a/Astraeos_WP/Astraeos_WP.ark"]);
    await assert.rejects(restoreSaveArchive(traversal, saved, PROFILE), /non ammesso/);
    assert.ok(!(await readdir(saved)).some((name) => name.startsWith(".")));
  } finally {
    for (const p of [saved, work]) await rm(p, { recursive: true, force: true });
  }
});

test("restoreSaveArchive recupera il profilo lasciato da un ripristino interrotto", async () => {
  const source = await savedFixture();
  const target = await savedFixture();
  const tarball = path.join(source, "..", `${path.basename(source)}.tar.zst`);
  try {
    await createSaveArchive(path.join(source, PROFILE), tarball);
    // Interruzione fra i due rename: il profilo esiste solo come copia di sicurezza.
    await rename(path.join(target, PROFILE), path.join(target, `.previous-${PROFILE}`));
    await put(target, `.restore-${PROFILE}/Astraeos_WP/Astraeos_WP.ark`, "estrazione-parziale");
    const corrupt = path.join(target, "Logs", "rotto.tar.zst");
    await writeFile(corrupt, "non è un tar");

    await assert.rejects(restoreSaveArchive(corrupt, target, PROFILE));
    assert.equal(await readFile(path.join(target, PROFILE, "Astraeos_WP", "Astraeos_WP.ark"), "utf8"), "mondo-attuale");
    assert.ok(!(await readdir(target)).some((name) => name.startsWith(".")));

    await restoreSaveArchive(tarball, target, PROFILE);
    assert.equal(await readFile(path.join(target, PROFILE, "Astraeos_WP", "Astraeos_WP.ark"), "utf8"), "mondo-attuale");
  } finally {
    for (const p of [source, target, tarball]) await rm(p, { recursive: true, force: true });
  }
});
