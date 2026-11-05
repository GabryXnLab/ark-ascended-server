import assert from "node:assert/strict";
import test from "node:test";
import { isUnobservedRestart } from "../src/boot-sync.js";

test("a changed bootId is a restart the poller did not see", () => {
  assert.equal(isUnobservedRestart("a", "b"), true);
  assert.equal(isUnobservedRestart("a", "a"), false);
  // First observation, or providers without a bootId (oci): no signal.
  assert.equal(isUnobservedRestart(undefined, "a"), false);
  assert.equal(isUnobservedRestart("a", undefined), false);
  assert.equal(isUnobservedRestart(undefined, undefined), false);
});
