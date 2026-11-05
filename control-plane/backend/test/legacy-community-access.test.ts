import test from "node:test";
import assert from "node:assert/strict";
import type { ServerCommunityAccess } from "../src/communities-store.js";
import { LEGACY_COMMUNITY_ID, LEGACY_SERVER_ID } from "../src/community-model.js";
import {
  resolveLegacyCommunityAccess,
  type LegacyCommunityAccessDependencies,
} from "../src/legacy-community-access.js";
import type { GoogleUser } from "../src/auth.js";

const user: GoogleUser = {
  id: "user-1",
  email: "amico@example.com",
  name: "Amico",
  avatarUrl: null,
};

function serverAccess(overrides: {
  role?: "owner" | "admin" | "moderator" | "member";
  status?: "active" | "suspended";
  membersEnabled?: boolean;
  power?: boolean;
  serverId?: string;
} = {}): ServerCommunityAccess {
  return {
    community: {
      id: LEGACY_COMMUNITY_ID,
      slug: "arksa-legacy",
      name: "ARKSA",
      description: "",
      language: "it",
      region: "us-ashburn-1",
      visibility: "private",
      join_policy: "invite",
      lifecycle: "active",
      members_enabled: overrides.membersEnabled ?? true,
      billing_exempt: true,
      legacy: true,
      created_at: "2026-08-28T00:00:00.000Z",
    },
    membership: {
      id: "membership-1",
      community_id: LEGACY_COMMUNITY_ID,
      user_id: user.id,
      role: overrides.role ?? "member",
      status: overrides.status ?? "active",
      permissions: { power: overrides.power ?? false },
      joined_at: "2026-08-28T00:00:00.000Z",
      last_used_at: null,
    },
    server: {
      id: overrides.serverId ?? LEGACY_SERVER_ID,
      community_id: LEGACY_COMMUNITY_ID,
      adapter: "legacy",
      lifecycle: "ready",
      provisioning_enabled: false,
    },
  };
}

function dependencies(access: ServerCommunityAccess | undefined, calls: string[]): LegacyCommunityAccessDependencies {
  return {
    ensureViewer: async () => { calls.push("ensure"); },
    getServerCommunityAccess: async () => {
      calls.push("access");
      return access;
    },
  };
}

test("l'alias v1 inizializza il viewer e usa membership e permessi v2", async () => {
  const calls: string[] = [];
  const result = await resolveLegacyCommunityAccess(
    user,
    LEGACY_COMMUNITY_ID,
    ["owner@example.com"],
    dependencies(serverAccess({ power: true }), calls),
  );
  assert.deepEqual(calls, ["ensure", "access"]);
  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(result.account.role, "friend");
  if (result.account.role === "friend") assert.equal(result.account.permissions.power, true);
  assert.equal(result.communityId, LEGACY_COMMUNITY_ID);
  assert.equal(result.serverId, LEGACY_SERVER_ID);
});

test("sospensione o eliminazione v2 negano immediatamente l'accesso legacy", async () => {
  const suspended = await resolveLegacyCommunityAccess(
    user,
    LEGACY_COMMUNITY_ID,
    [],
    dependencies(serverAccess({ status: "suspended" }), []),
  );
  assert.deepEqual(suspended, { allowed: false, reason: "suspended" });

  const deleted = await resolveLegacyCommunityAccess(
    user,
    LEGACY_COMMUNITY_ID,
    [],
    dependencies(undefined, []),
  );
  assert.deepEqual(deleted, { allowed: false, reason: "missing" });
});

test("il kill-switch blocca i membri ma non owner e admin", async () => {
  for (const role of ["member", "moderator"] as const) {
    const denied = await resolveLegacyCommunityAccess(
      user,
      LEGACY_COMMUNITY_ID,
      [],
      dependencies(serverAccess({ role, membersEnabled: false }), []),
    );
    assert.deepEqual(denied, { allowed: false, reason: "members-disabled" });
  }
  for (const role of ["owner", "admin"] as const) {
    const allowed = await resolveLegacyCommunityAccess(
      user,
      LEGACY_COMMUNITY_ID,
      [],
      dependencies(serverAccess({ role, membersEnabled: false }), []),
    );
    assert.equal(allowed.allowed, true);
    if (allowed.allowed) assert.equal(allowed.account.role, "admin");
  }
});

test("un aggiornamento permessi v2 è applicato a ogni nuova richiesta v1", async () => {
  const before = await resolveLegacyCommunityAccess(
    user,
    LEGACY_COMMUNITY_ID,
    [],
    dependencies(serverAccess({ power: false }), []),
  );
  const after = await resolveLegacyCommunityAccess(
    user,
    LEGACY_COMMUNITY_ID,
    [],
    dependencies(serverAccess({ power: true }), []),
  );
  assert.equal(before.allowed && before.account.role === "friend" && before.account.permissions.power, false);
  assert.equal(after.allowed && after.account.role === "friend" && after.account.permissions.power, true);
});

test("rifiuta server non legacy e mantiene il contesto notifiche sul tenant legacy", async () => {
  const unsupported = await resolveLegacyCommunityAccess(
    user,
    LEGACY_COMMUNITY_ID,
    [],
    dependencies(serverAccess({ serverId: "00000000-0000-4000-8000-000000000099" }), []),
  );
  assert.deepEqual(unsupported, { allowed: false, reason: "unsupported" });

  const allowed = await resolveLegacyCommunityAccess(
    user,
    LEGACY_COMMUNITY_ID,
    [],
    dependencies(serverAccess(), []),
  );
  assert.equal(allowed.allowed && allowed.communityId, LEGACY_COMMUNITY_ID);
  assert.equal(allowed.allowed && allowed.serverId, LEGACY_SERVER_ID);
});
