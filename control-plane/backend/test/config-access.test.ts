import test from "node:test";
import assert from "node:assert/strict";
import { configCapabilities } from "../src/config-access.js";
import type { GameConfiguration } from "../src/configs-store.js";

function configuration(overrides: Partial<GameConfiguration> = {}): GameConfiguration {
  return {
    id: "config-1",
    revision: 1,
    name: "Astraeos",
    map: "Astraeos_WP",
    mods: [],
    iniOverrides: {
      gus: { values: {}, sections: {} },
      game: { values: {}, sections: {} },
    },
    ownerId: "owner-user",
    ownerName: "Owner",
    accessControl: { administratorLocked: false, grants: {} },
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

test("il proprietario gestisce e modifica la propria configurazione", () => {
  assert.deepEqual(configCapabilities(configuration(), {
    userId: "owner-user",
    administrator: false,
  }), {
    access: "full",
    isOwner: true,
    canManageAccess: true,
    canDelete: true,
  });
});

test("i grant distinguono revisione, modifica completa e nessun accesso", () => {
  const config = configuration({
    accessControl: {
      administratorLocked: false,
      grants: { reviewer: "review", editor: "full" },
    },
  });
  assert.equal(configCapabilities(config, { userId: "reviewer", administrator: false }).access, "review");
  assert.equal(configCapabilities(config, { userId: "editor", administrator: false }).access, "full");
  assert.equal(configCapabilities(config, { userId: "stranger", administrator: false }).access, "none");
});

test("il blocco amministrativo prevale anche sul proprietario", () => {
  const locked = configuration({
    accessControl: { administratorLocked: true, grants: {} },
  });
  assert.deepEqual(configCapabilities(locked, { userId: "owner-user", administrator: false }), {
    access: "none",
    isOwner: true,
    canManageAccess: false,
    canDelete: false,
  });

  const explicitlyAllowed = configuration({
    accessControl: { administratorLocked: true, grants: { "owner-user": "review" } },
  });
  assert.equal(
    configCapabilities(explicitlyAllowed, { userId: "owner-user", administrator: false }).access,
    "review",
  );
});

test("owner e admin della community ignorano sempre i blocchi", () => {
  const capabilities = configCapabilities(configuration({
    accessControl: { administratorLocked: true, grants: {} },
  }), {
    userId: "community-admin",
    administrator: true,
  });
  assert.equal(capabilities.access, "full");
  assert.equal(capabilities.canManageAccess, true);
  assert.equal(capabilities.canDelete, true);
});

test("riconosce gli ownerId legacy basati sulla membership", () => {
  const capabilities = configCapabilities(configuration({ ownerId: "membership-legacy" }), {
    userId: "owner-user",
    legacyOwnerIds: ["membership-legacy"],
    administrator: false,
  });
  assert.equal(capabilities.isOwner, true);
  assert.equal(capabilities.access, "full");
});
