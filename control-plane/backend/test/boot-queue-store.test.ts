import { after, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const tmpDir = path.join(os.tmpdir(), `arksa-boot-queue-store-${process.pid}`);
process.env.BOOT_QUEUE_DATA_FILE = path.join(tmpDir, "boot-queue.json");

const store = await import("../src/boot-queue-store.js");
const FIRST_ID = "0123456789abcdef0123456789abcdef";
const SECOND_ID = "ABCDEF0123456789ABCDEF0123456789";

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("la whitelist sostituisce la precedente e ha priorità sull'avvio configurazione", async () => {
  await store.enqueueBootOp("selectConfig", { id: "astraeos" });
  await store.enqueueBootOp("adminWhitelist", { accountIds: [FIRST_ID] });
  await store.enqueueBootOp("adminWhitelist", { accountIds: [SECOND_ID] });

  const queue = await store.listBootQueue();
  assert.equal(queue.length, 2);
  assert.equal(queue[0]?.kind, "adminWhitelist");
  assert.deepEqual(queue[0]?.payload, { accountIds: [SECOND_ID] });
  assert.equal(queue[1]?.kind, "selectConfig");

  await store.clearQueuedAdminWhitelist();
  assert.deepEqual((await store.listBootQueue()).map((op) => op.kind), ["selectConfig"]);
});

test("scarta le operazioni dirette ritirate lasciate da un backend precedente", async () => {
  const file = process.env.BOOT_QUEUE_DATA_FILE!;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify([
    { id: "a", kind: "mods", payload: { mapId: "x", mods: [1] }, queuedAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", kind: "ini", payload: { file: "Game", values: {}, sections: {} }, queuedAt: "2026-01-01T00:00:00.000Z" },
    { id: "c", kind: "selectConfig", payload: { id: "astraeos" }, queuedAt: "2026-01-01T00:00:00.000Z" },
  ]));
  const fresh = await import(`../src/boot-queue-store.js?legacy=${Date.now()}`);
  assert.deepEqual((await fresh.listBootQueue()).map((op: { id: string }) => op.id), ["c"]);
  assert.equal(await fresh.getQueuedConfigSelectId(), "astraeos");
});
