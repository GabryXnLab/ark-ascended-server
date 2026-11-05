import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteBackup } from "../src/backup-store.js";

test("deleteBackup locale rimuove file e versioni ed è idempotente", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-backups-"));
  try {
    await mkdir(path.join(dir, "saves", ".versions", "p1"), { recursive: true });
    await writeFile(path.join(dir, "saves", "p1.tar.zst"), "x");
    await writeFile(path.join(dir, "saves", "p2.tar.zst"), "x");
    await writeFile(path.join(dir, "saves", ".versions", "p1", "2026-11-05.tar.zst"), "x");
    const opts = { provider: "docker", backupDir: dir };
    await deleteBackup("saves/p1.tar.zst", opts);
    assert.equal(existsSync(path.join(dir, "saves", "p1.tar.zst")), false);
    assert.equal(existsSync(path.join(dir, "saves", ".versions", "p1")), false);
    assert.equal(existsSync(path.join(dir, "saves", "p2.tar.zst")), true);
    await deleteBackup("saves/p1.tar.zst", opts);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("deleteBackup locale rifiuta chiavi con traversal", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-backups-"));
  try {
    const opts = { provider: "docker", backupDir: path.join(dir, "b") };
    await writeFile(path.join(dir, "fuori.tar.zst"), "x");
    for (const key of ["saves/../../fuori.tar.zst", "../fuori.tar.zst", "/etc/passwd", "saves/a/b.tar.zst", "saves/.tar.zst", "saves/x.tar.zst\n"]) {
      await assert.rejects(deleteBackup(key, opts), /non valida/, key);
    }
    assert.equal(existsSync(path.join(dir, "fuori.tar.zst")), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
