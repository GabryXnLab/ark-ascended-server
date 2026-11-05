import type { Account, GoogleUser } from "./auth.js";
import {
  ensureViewer,
  getServerCommunityAccess,
  type ServerCommunityAccess,
} from "./communities-store.js";
import {
  LEGACY_COMMUNITY_ID,
  LEGACY_SERVER_ID,
  normalizeMemberPermissions,
} from "./community-model.js";

export interface LegacyCommunityAccessDependencies {
  ensureViewer(user: GoogleUser, adminEmails: string[]): Promise<unknown>;
  getServerCommunityAccess(communityId: string, userId: string): Promise<ServerCommunityAccess | undefined>;
}

export type LegacyCommunityAccessResult =
  | {
      allowed: true;
      account: Account;
      communityId: string;
      serverId: string;
      communityRole: ServerCommunityAccess["membership"]["role"];
    }
  | { allowed: false; reason: "missing" | "unsupported" | "suspended" | "members-disabled" };

const defaultDependencies: LegacyCommunityAccessDependencies = {
  ensureViewer,
  getServerCommunityAccess,
};

/**
 * Sorgente di verità unica per l'accesso al server singleton, usata sia
 * dall'adapter v2 sia dall'alias v1. La chiamata a ensureViewer rende sicuro
 * anche il primo accesso di una vecchia PWA rimasta in cache.
 */
export async function resolveLegacyCommunityAccess(
  user: GoogleUser,
  communityId: string,
  adminEmails: string[],
  dependencies: LegacyCommunityAccessDependencies = defaultDependencies,
): Promise<LegacyCommunityAccessResult> {
  await dependencies.ensureViewer(user, adminEmails);
  const access = await dependencies.getServerCommunityAccess(communityId, user.id);
  if (!access) return { allowed: false, reason: "missing" };
  if (
    access.community.id !== LEGACY_COMMUNITY_ID
    || access.server.id !== LEGACY_SERVER_ID
    || access.server.adapter !== "legacy"
    || access.server.lifecycle !== "ready"
  ) {
    return { allowed: false, reason: "unsupported" };
  }
  if (access.membership.status !== "active") return { allowed: false, reason: "suspended" };

  const isAdmin = access.membership.role === "owner" || access.membership.role === "admin";
  if (!isAdmin && !access.community.members_enabled) {
    return { allowed: false, reason: "members-disabled" };
  }

  const account: Account = isAdmin
    ? { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: "admin" }
    : {
        id: access.membership.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: "friend",
        permissions: normalizeMemberPermissions(access.membership.permissions),
      };
  return {
    allowed: true,
    account,
    communityId: access.community.id,
    serverId: access.server.id,
    communityRole: access.membership.role,
  };
}
