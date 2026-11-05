import test from "node:test";
import assert from "node:assert/strict";
import {
  CommunityValidationError,
  communitySlug,
  normalizeDiscoveryQuery,
  normalizeArkAccountId,
  normalizeMemberPermissions,
  validateCommunityCreate,
} from "../src/community-model.js";
import { canOpenCommunityByLink } from "../src/communities-store.js";

test("communitySlug normalizza accenti e rimuove caratteri ambigui", () => {
  assert.equal(communitySlug("  Gli Esploratori d'Àrka!  "), "gli-esploratori-d-arka");
  assert.equal(communitySlug("🔥🔥🔥"), "");
});

test("validateCommunityCreate applica default senza allocare un server", () => {
  assert.deepEqual(validateCommunityCreate({ name: "I Sopravvissuti" }), {
    name: "I Sopravvissuti",
    slug: "i-sopravvissuti",
    description: "",
    visibility: "public",
    language: "it",
    region: "us-ashburn-1",
  });
});

test("validateCommunityCreate rifiuta nomi e visibilità non validi", () => {
  assert.throws(() => validateCommunityCreate({ name: "x" }), CommunityValidationError);
  assert.throws(
    () => validateCommunityCreate({ name: "Community", visibility: "everyone" as "public" }),
    CommunityValidationError,
  );
});

test("normalizeDiscoveryQuery limita wildcard e lunghezza", () => {
  assert.equal(normalizeDiscoveryQuery("  ARK%_ Italia  "), "ark italia");
  assert.equal(normalizeDiscoveryQuery("x".repeat(100)).length, 80);
});

test("normalizeArkAccountId accetta un solo ID alfanumerico di 32 caratteri", () => {
  assert.equal(normalizeArkAccountId(" 0123456789abcdef0123456789ABCDEF "), "0123456789abcdef0123456789ABCDEF");
  assert.equal(normalizeArkAccountId(""), null);
  assert.throws(() => normalizeArkAccountId("troppo-corto"), CommunityValidationError);
  assert.throws(() => normalizeArkAccountId("0123456789abcdef0123456789abcde!"), CommunityValidationError);
});

test("un link diretto apre community pubbliche e non elencate, mai private estranee", () => {
  assert.equal(canOpenCommunityByLink({ visibility: "public", lifecycle: "active" }, false), true);
  assert.equal(canOpenCommunityByLink({ visibility: "unlisted", lifecycle: "active" }, false), true);
  assert.equal(canOpenCommunityByLink({ visibility: "private", lifecycle: "active" }, false), false);
  assert.equal(canOpenCommunityByLink({ visibility: "unlisted", lifecycle: "draft" }, false), false);
  assert.equal(canOpenCommunityByLink({ visibility: "private", lifecycle: "suspended" }, true), true);
});

test("normalizeMemberPermissions scarta i flag ritirati e applica i default sicuri", () => {
  assert.deepEqual(
    normalizeMemberPermissions({ power: false, mapSwitch: true, proposeIni: true, applyConfig: true }),
    { power: false, timer: false, applyConfig: true },
  );
  assert.deepEqual(normalizeMemberPermissions(null), { power: true, timer: false, applyConfig: false });
});
