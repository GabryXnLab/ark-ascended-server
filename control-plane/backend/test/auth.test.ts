import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGoogleName } from "../src/auth.js";

test("normalizza il nome Google per profili e notifiche", () => {
  assert.equal(normalizeGoogleName("  Gaia  ", "gaia@example.com"), "Gaia");
  assert.equal(normalizeGoogleName("   ", "gaia@example.com"), "gaia");
  assert.equal(normalizeGoogleName(undefined, "@example.com"), "Utente");
  assert.equal(normalizeGoogleName("x".repeat(150), "gaia@example.com").length, 120);
});
