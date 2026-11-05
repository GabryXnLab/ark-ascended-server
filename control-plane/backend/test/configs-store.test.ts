import { after, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const tmpDir = path.join(os.tmpdir(), `arksa-configs-store-${process.pid}`);
process.env.CONFIGS_DATA_FILE = path.join(tmpDir, "configs.json");
process.env.CURRENT_CONFIG_FILE = path.join(tmpDir, "current.json");

const store = await import("../src/configs-store.js");

const base = {
  name: "Astraeos",
  map: "Astraeos_WP",
  mods: [988598],
  iniOverrides: {
    gus: { values: { XPMultiplier: "2" }, sections: {} },
    game: { values: {}, sections: {} },
    launchArgs: "",
  },
};

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("la revisione cambia solo quando cambia il contenuto della configurazione", async () => {
  const owner = { id: "admin", name: "Admin" };
  const created = await store.upsertConfig(base, owner);
  assert.equal(created.revision, 1);

  const identical = await store.upsertConfig(structuredClone(base), owner, created.id);
  assert.equal(identical.revision, 1);

  const changed = await store.upsertConfig({
    ...structuredClone(base),
    mods: [988598, 123456],
  }, owner, created.id);
  assert.equal(changed.revision, 2);

  const persisted = JSON.parse(await fs.readFile(process.env.CONFIGS_DATA_FILE!, "utf8")) as Array<{ revision: number }>;
  assert.equal(persisted[0]?.revision, 2);
});

test("la modifica ACL non cambia la revisione runtime", async () => {
  const owner = { id: "owner-user", name: "Owner" };
  const created = await store.upsertConfig({ ...structuredClone(base), name: "ACL test" }, owner);
  const updated = await store.updateConfigAccess(created.id, {
    administratorLocked: true,
    grants: { reviewer: "review", editor: "full" },
  });
  assert.equal(updated?.revision, created.revision);
  assert.deepEqual(updated?.accessControl, {
    administratorLocked: true,
    grants: { reviewer: "review", editor: "full" },
  });
  assert.ok(updated?.accessUpdatedAt);
});
