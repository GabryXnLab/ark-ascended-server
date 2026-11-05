import "./env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { saveWorldAndSettle } from "../src/ark.js";

test("saveWorldAndSettle non esegue saveworld se ASA non è online", async () => {
  assert.equal(await saveWorldAndSettle(), false);
});
