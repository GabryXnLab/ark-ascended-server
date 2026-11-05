import "./env.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { config } from "../src/config.js";
import {
  formatAdminWhitelistText,
  normalizeAdminAccountIds,
  readAdminWhitelist,
  replaceAdminWhitelist,
} from "../src/admin-whitelist.js";

const FIRST_ID = "0123456789abcdef0123456789abcdef";
const SECOND_ID = "ABCDEF0123456789ABCDEF0123456789";

after(async () => {
  await fs.rm(config.allowedCheaterAccountsFile, { force: true });
});

test("valida e deduplica gli EOS/ARK account id", () => {
  assert.deepEqual(normalizeAdminAccountIds([` ${FIRST_ID} `, FIRST_ID, SECOND_ID]), [FIRST_ID, SECOND_ID]);
  assert.throws(() => normalizeAdminAccountIds(["troppo-corto"]), /32 caratteri alfanumerici/);
  assert.throws(() => normalizeAdminAccountIds([`${FIRST_ID.slice(0, 31)}!`]), /32 caratteri alfanumerici/);
  assert.throws(() => normalizeAdminAccountIds("non-array"), /deve essere un array/);
  assert.equal(formatAdminWhitelistText([FIRST_ID, SECOND_ID]), `${FIRST_ID}\n${SECOND_ID}\n`);
  assert.equal(formatAdminWhitelistText([]), "");
});

test("scrive e sostituisce atomicamente AllowedCheaterAccountIDs.txt in modalità 0600", async () => {
  await replaceAdminWhitelist([FIRST_ID, SECOND_ID]);
  assert.equal(await fs.readFile(config.allowedCheaterAccountsFile, "utf8"), `${FIRST_ID}\n${SECOND_ID}\n`);
  assert.deepEqual(await readAdminWhitelist(), [FIRST_ID, SECOND_ID]);
  assert.equal((await fs.stat(config.allowedCheaterAccountsFile)).mode & 0o777, 0o600);

  await replaceAdminWhitelist([]);
  assert.equal(await fs.readFile(config.allowedCheaterAccountsFile, "utf8"), "");
  assert.deepEqual(await readAdminWhitelist(), []);
});
