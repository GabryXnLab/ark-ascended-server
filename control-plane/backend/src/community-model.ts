import { randomUUID } from "node:crypto";

export const LEGACY_COMMUNITY_ID = "00000000-0000-4000-8000-000000000001";
export const LEGACY_SERVER_ID = "00000000-0000-4000-8000-000000000002";

/** Permessi server di un membro non amministratore. Mappa, mod e parametri non hanno
 * permessi dedicati: passano dalle ACL delle configurazioni (decisione 17). */
export interface FriendPermissions {
  power: boolean;
  timer: boolean;
  applyConfig: boolean;
}

export type FriendStatus = "pending" | "accepted" | "rejected";

export interface FriendAccount {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  arkAccountId?: string | null;
  authUserId: string | null;
  permissions: FriendPermissions;
  disabled: boolean;
  status: FriendStatus;
  authorizedAt: string;
  lastUsedAt: string | null;
  communityRole?: "admin" | "moderator" | "member";
}

export const SAFE_MEMBER_PERMISSIONS: FriendPermissions = {
  power: true,
  timer: false,
  applyConfig: false,
};

/**
 * Il JSON salvato in Supabase può ancora contenere flag ritirati (mapSwitch,
 * propose*): si tengono solo le chiavi correnti, con i default sicuri.
 */
export function normalizeMemberPermissions(value: Partial<Record<string, unknown>> | null | undefined): FriendPermissions {
  const result = { ...SAFE_MEMBER_PERMISSIONS };
  for (const key of Object.keys(SAFE_MEMBER_PERMISSIONS) as Array<keyof FriendPermissions>) {
    if (typeof value?.[key] === "boolean") result[key] = value[key] as boolean;
  }
  return result;
}

export type CommunityVisibility = "public" | "unlisted" | "private";
export type CommunityRole = "owner" | "admin" | "moderator" | "member";
export type CommunityLifecycle = "draft" | "active" | "suspended" | "closing" | "archived";
export type JoinRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface CommunityCreateInput {
  name: string;
  slug?: string;
  description?: string;
  visibility?: CommunityVisibility;
  language?: string;
  region?: string;
}

export interface ValidatedCommunityCreate {
  name: string;
  slug: string;
  description: string;
  visibility: CommunityVisibility;
  language: string;
  region: string;
}

export class CommunityValidationError extends Error {
  code = "COMMUNITY_VALIDATION";
}

/** Slug ASCII deliberatamente restrittivo per evitare omografie e URL ambigui. */
export function communitySlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function validateCommunityCreate(input: CommunityCreateInput): ValidatedCommunityCreate {
  const name = input.name?.trim() ?? "";
  if (name.length < 3 || name.length > 80) {
    throw new CommunityValidationError("il nome della community deve contenere da 3 a 80 caratteri");
  }
  const baseSlug = communitySlug(input.slug?.trim() || name);
  if (baseSlug.length < 3) throw new CommunityValidationError("slug della community non valido");
  const description = input.description?.trim() ?? "";
  if (description.length > 600) throw new CommunityValidationError("la descrizione non può superare 600 caratteri");
  const visibility = input.visibility ?? "public";
  if (!["public", "unlisted", "private"].includes(visibility)) {
    throw new CommunityValidationError("visibilità non valida");
  }
  const language = input.language?.trim() || "it";
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)) throw new CommunityValidationError("lingua non valida");
  const region = input.region?.trim() || "us-ashburn-1";
  if (!/^[a-z0-9-]{3,40}$/.test(region)) throw new CommunityValidationError("regione non valida");
  return { name, slug: baseSlug, description, visibility, language, region };
}

/** Suffisso breve per risolvere collisioni senza esporre identificativi utente. */
export function uniqueCommunitySlug(base: string): string {
  return `${base.slice(0, 39).replace(/-+$/g, "")}-${randomUUID().slice(0, 8)}`;
}

export function normalizeDiscoveryQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLocaleLowerCase("it-IT").replace(/[%_]/g, "").slice(0, 80);
}

export function normalizeArkAccountId(value: string | null): string | null {
  const normalized = value?.trim() || null;
  if (normalized !== null && !/^[A-Za-z0-9]{32}$/.test(normalized)) {
    throw new CommunityValidationError("l'EOS/ARK ID deve contenere esattamente 32 caratteri alfanumerici");
  }
  return normalized;
}
