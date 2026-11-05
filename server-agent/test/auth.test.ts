import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoopbackAddress } from "../src/auth.js";

test("riconosce soltanto gli indirizzi loopback per la whitelist ASA", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("10.0.0.28"), false);
  assert.equal(isLoopbackAddress("::ffff:10.0.0.28"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});
