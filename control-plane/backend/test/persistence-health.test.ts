import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkPersistence } from "../src/persistence-health.js";

test("verifica scrittura, lettura e rename atomico della directory dati", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-health-"));
  try {
    assert.deepEqual(await checkPersistence(dir), { ok: true });
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("segnala una destinazione che non è una directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-health-invalid-"));
  const blocker = path.join(dir, "file");
  await writeFile(blocker, "x");
  try {
    const result = await checkPersistence(blocker);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
