import "./env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { LocalBackupStore, assertValidObjectKey } from "../src/backup-store.js";
import { config } from "../src/config.js";
import { selfStop } from "../src/selfstop.js";
import { restoreIdleBootVolumePerformance } from "../src/boot-volume-performance.js";

const KEY = "saves/abc_1.tar.zst";

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "arksa-bs-"));
}
async function src(dir: string, content: string): Promise<string> {
  const f = path.join(dir, `src-${Math.random().toString(36).slice(2)}`);
  await fs.writeFile(f, content);
  return f;
}

test("put scrive la copia corrente senza residui tmp e con permessi 0660", async () => {
  const dir = await tmp();
  const store = new LocalBackupStore(path.join(dir, "b"), { keepVersions: 5, retentionDays: 30 });
  const size = await store.put(KEY, await src(dir, "uno"));
  assert.equal(size, 3);
  const target = path.join(dir, "b", KEY);
  assert.equal(await fs.readFile(target, "utf8"), "uno");
  assert.equal((await fs.stat(target)).mode & 0o777, 0o660);
  assert.deepEqual((await fs.readdir(path.dirname(target))).filter((n) => n.includes(".tmp-")), []);
});

test("put con sorgente mancante non tocca la copia corrente", async () => {
  const dir = await tmp();
  const store = new LocalBackupStore(path.join(dir, "b"), { keepVersions: 5, retentionDays: 30 });
  await store.put(KEY, await src(dir, "buona"));
  await assert.rejects(store.put(KEY, path.join(dir, "non-esiste")));
  assert.equal(await fs.readFile(path.join(dir, "b", KEY), "utf8"), "buona");
  assert.deepEqual((await fs.readdir(path.join(dir, "b", "saves"))).filter((n) => n.includes(".tmp-")), []);
});

test("la versione precedente finisce in .versions e la retention per numero la limita", async () => {
  const dir = await tmp();
  const root = path.join(dir, "b");
  const store = new LocalBackupStore(root, { keepVersions: 2, retentionDays: 0 });
  for (let i = 0; i < 5; i++) {
    const f = await src(dir, `v${i}`);
    await store.put(KEY, f);
    // mtime distinti: il nome della versione deriva dall'mtime del file sostituito
    await fs.utimes(path.join(root, KEY), new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i));
  }
  const vdir = path.join(root, "saves", ".versions", "abc_1");
  const names = (await fs.readdir(vdir)).sort();
  assert.equal(names.length, 2);
  const contents = await Promise.all(names.map((n) => fs.readFile(path.join(vdir, n), "utf8")));
  assert.deepEqual(contents, ["v2", "v3"]);
  assert.equal(await fs.readFile(path.join(root, KEY), "utf8"), "v4");
});

test("la retention per giorni elimina le versioni vecchie", async () => {
  const dir = await tmp();
  const root = path.join(dir, "b");
  let now = new Date(2026, 5, 1).getTime();
  const store = new LocalBackupStore(root, { keepVersions: 10, retentionDays: 30, now: () => now });
  await store.put(KEY, await src(dir, "a"));
  await fs.utimes(path.join(root, KEY), new Date(2026, 0, 1), new Date(2026, 0, 1));
  await store.put(KEY, await src(dir, "b")); // "a" (mtime gennaio) diventa versione, ma ha > 30 giorni
  const vdir = path.join(root, "saves", ".versions", "abc_1");
  assert.deepEqual(await fs.readdir(vdir), []);
  await fs.utimes(path.join(root, KEY), new Date(now - 86_400_000), new Date(now - 86_400_000));
  await store.put(KEY, await src(dir, "c")); // "b" ha 1 giorno: resta
  assert.equal((await fs.readdir(vdir)).length, 1);
});

test("chiavi con traversal o formato errato sono rifiutate", async () => {
  const dir = await tmp();
  const store = new LocalBackupStore(path.join(dir, "b"), { keepVersions: 5, retentionDays: 30 });
  const f = await src(dir, "x");
  for (const bad of ["../x.tar.zst", "saves/../../etc.tar.zst", "/etc/passwd", "saves/a/b.tar.zst", "saves/.versions/x.tar.zst", "saves/a.tar", "saves/a.tar.zst\n", ""]) {
    assert.throws(() => assertValidObjectKey(bad), /objectKey non valida/, bad);
    await assert.rejects(store.put(bad, f), /objectKey non valida/, bad);
    await assert.rejects(store.fetch(bad, path.join(dir, "o")), /objectKey non valida/, bad);
  }
  assert.throws(() => assertValidObjectKey(42));
});

test("fetch copia il contenuto e segnala un backup mancante", async () => {
  const dir = await tmp();
  const store = new LocalBackupStore(path.join(dir, "b"), { keepVersions: 5, retentionDays: 30 });
  await assert.rejects(store.fetch(KEY, path.join(dir, "o")), /backup non trovato/);
  await store.put(KEY, await src(dir, "dati"));
  await store.fetch(KEY, path.join(dir, "out"));
  assert.equal(await fs.readFile(path.join(dir, "out"), "utf8"), "dati");
});

test("in docker selfStop invia SIGTERM al proprio processo senza toccare OCI", async () => {
  const prev = config.platform;
  const prevMode = config.mode;
  config.platform = "docker";
  config.mode = "live"; // in mock il no-op sarebbe banale: qui deve valere per la sola piattaforma
  try {
    const calls: Array<[number, string]> = [];
    assert.equal(await selfStop({ kill: (pid, sig) => void calls.push([pid, sig]) }), true);
    assert.deepEqual(calls, [[process.pid, "SIGTERM"]]);
    await restoreIdleBootVolumePerformance(); // no-op: nessuna chiamata di rete
  } finally {
    config.platform = prev;
    config.mode = prevMode;
  }
});
