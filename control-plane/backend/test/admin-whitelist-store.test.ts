import { after, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const tmpDir = path.join(os.tmpdir(), `arksa-admin-whitelist-store-${process.pid}`);
process.env.ADMIN_WHITELIST_DATA_FILE = path.join(tmpDir, "admin-whitelist.json");

const store = await import("../src/admin-whitelist-store.js");
const FIRST_ID = "0123456789abcdef0123456789abcdef";
const SECOND_ID = "ABCDEF0123456789ABCDEF0123456789";

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("distingue lo stato mai inizializzato da una whitelist vuota", async () => {
  assert.equal(await store.getAdminWhitelistState(), null);
  const saved = await store.saveAdminWhitelistState([], { id: "admin", name: "Admin" });
  assert.deepEqual(saved.accountIds, []);
  assert.deepEqual((await store.getAdminWhitelistState())?.accountIds, []);
});

test("valida, deduplica e persiste gli account id con permessi 0600", async () => {
  const saved = await store.saveAdminWhitelistState(
    [FIRST_ID, ` ${SECOND_ID} `, FIRST_ID],
    { id: "admin", name: "Admin" },
  );
  assert.deepEqual(saved.accountIds, [FIRST_ID, SECOND_ID]);
  assert.equal((await fs.stat(process.env.ADMIN_WHITELIST_DATA_FILE!)).mode & 0o777, 0o600);
  assert.match(await fs.readFile(process.env.ADMIN_WHITELIST_DATA_FILE!, "utf8"), new RegExp(FIRST_ID));
  assert.throws(() => store.normalizeAdminAccountIds(["id-non-valido"]), /32 caratteri alfanumerici/);
});
