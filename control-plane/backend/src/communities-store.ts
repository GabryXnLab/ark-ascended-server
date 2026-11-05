import { randomUUID } from "node:crypto";
import type { GoogleUser } from "./auth.js";
import { getSupabaseAdmin } from "./supabase.js";
import {
  LEGACY_COMMUNITY_ID,
  normalizeMemberPermissions,
  SAFE_MEMBER_PERMISSIONS,
  type FriendAccount,
  type FriendPermissions,
  type CommunityCreateInput,
  type CommunityLifecycle,
  type CommunityRole,
  type CommunityVisibility,
  type JoinRequestStatus,
  normalizeArkAccountId,
  uniqueCommunitySlug,
  validateCommunityCreate,
} from "./community-model.js";

interface ProfileRow {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  ark_account_id: string | null;
}

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  language: string;
  region: string;
  visibility: CommunityVisibility;
  join_policy: "request" | "invite" | "closed";
  lifecycle: CommunityLifecycle;
  members_enabled: boolean;
  billing_exempt: boolean;
  legacy: boolean;
  created_at: string;
}

interface MembershipRow {
  id: string;
  community_id: string;
  user_id: string;
  role: CommunityRole;
  status: "active" | "suspended";
  permissions: Partial<FriendPermissions> | null;
  joined_at: string;
  last_used_at: string | null;
}

interface InvitationRow {
  id: string;
  community_id: string;
  email: string;
  permissions: Partial<FriendPermissions> | null;
  status: "pending" | "claimed" | "revoked";
  created_at: string;
}

interface JoinRequestRow {
  id: string;
  community_id: string;
  requester_user_id: string;
  message: string;
  status: JoinRequestStatus;
  reviewer_user_id: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

interface ServerRow {
  id: string;
  community_id: string;
  adapter: "legacy" | "fleet";
  lifecycle: "unallocated" | "provisioning" | "ready" | "suspended" | "deleting" | "deleted" | "error";
  provisioning_enabled: boolean;
}

export interface PublicMembership {
  id: string;
  role: CommunityRole;
  status: "active" | "suspended";
  permissions: FriendPermissions;
}

export interface CommunitySummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  language: string;
  region: string;
  visibility: CommunityVisibility;
  joinPolicy: "request" | "invite" | "closed";
  lifecycle: CommunityLifecycle;
  membersEnabled: boolean;
  membership: PublicMembership | null;
  joinRequest: { id: string; status: JoinRequestStatus; createdAt: string } | null;
  server: { available: boolean; lifecycle: ServerRow["lifecycle"] } | null;
}

export interface ViewerProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  arkAccountId: string | null;
}

export interface CommunityMemberDirectoryEntry extends ViewerProfile {
  membershipId: string;
  role: CommunityRole;
}

export interface CommunityJoinRequest {
  id: string;
  communityId: string;
  requester: ViewerProfile;
  message: string;
  status: JoinRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ServerCommunityAccess {
  community: CommunityRow;
  membership: MembershipRow;
  server: ServerRow;
}

function dbError(error: { message: string; code?: string } | null): never {
  const wrapped = Object.assign(new Error(`Supabase: ${error?.message ?? "errore sconosciuto"}`), { code: error?.code });
  throw wrapped;
}

function rows<T>(data: T[] | null, error: { message: string; code?: string } | null): T[] {
  if (error) dbError(error);
  return data ?? [];
}

function permissions(value: Partial<FriendPermissions> | null | undefined): FriendPermissions {
  return normalizeMemberPermissions(value);
}

function publicMembership(row: MembershipRow | undefined): PublicMembership | null {
  if (!row) return null;
  return { id: row.id, role: row.role, status: row.status, permissions: permissions(row.permissions) };
}

function communitySummary(
  community: CommunityRow,
  membership?: MembershipRow,
  request?: JoinRequestRow,
  server?: ServerRow,
): CommunitySummary {
  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description,
    language: community.language,
    region: community.region,
    visibility: community.visibility,
    joinPolicy: community.join_policy,
    lifecycle: community.lifecycle,
    membersEnabled: community.members_enabled,
    membership: publicMembership(membership),
    joinRequest: request ? { id: request.id, status: request.status, createdAt: request.created_at } : null,
    server: server ? { available: server.adapter === "legacy" && server.lifecycle === "ready", lifecycle: server.lifecycle } : null,
  };
}

export function canOpenCommunityByLink(
  community: Pick<CommunityRow, "visibility" | "lifecycle">,
  hasMembership: boolean,
): boolean {
  if (hasMembership) return true;
  return community.lifecycle === "active" && community.visibility !== "private";
}

async function membershipFor(communityId: string, userId: string): Promise<MembershipRow | undefined> {
  const { data, error } = await getSupabaseAdmin()
    .from("arksa_community_memberships")
    .select("*")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return (data as MembershipRow | null) ?? undefined;
}

export async function getActiveCommunityMembership(
  communityId: string,
  userId: string,
): Promise<PublicMembership | undefined> {
  const membership = await membershipFor(communityId, userId);
  if (!membership || membership.status !== "active") return undefined;
  return publicMembership(membership) ?? undefined;
}

/** ADMIN_EMAILS resta autorevole per i ruoli illimitati del tenant legacy. */
async function requireReviewer(communityId: string, userId: string): Promise<MembershipRow> {
  const membership = await membershipFor(communityId, userId);
  if (!membership || membership.status !== "active" || !["owner", "admin", "moderator"].includes(membership.role)) {
    throw Object.assign(new Error("permesso di revisione richieste non concesso"), { code: "COMMUNITY_FORBIDDEN" });
  }
  return membership;
}

/**
 * Crea/aggiorna il profilo, collega gli inviti email preesistenti e assegna gli
 * ADMIN_EMAILS alla community legacy. È idempotente e non tocca OCI né i file di gioco.
 */
export async function ensureViewer(user: GoogleUser, adminEmails: string[]): Promise<ViewerProfile> {
  const db = getSupabaseAdmin();
  const profile: ProfileRow = {
    user_id: user.id,
    email: user.email.toLowerCase(),
    name: user.name,
    avatar_url: user.avatarUrl,
    // Non includere ark_account_id nell'upsert: un nuovo login Google aggiorna
    // nome/avatar ma non deve mai cancellare il collegamento impostato dall'utente.
    ark_account_id: null,
  };
  const { ark_account_id: _arkAccountId, ...profileIdentity } = profile;
  const profileResponse = await db
    .from("arksa_profiles")
    .upsert(profileIdentity, { onConflict: "user_id" })
    .select("*")
    .single();
  if (profileResponse.error || !profileResponse.data) {
    dbError(profileResponse.error ?? { message: "profilo non inizializzato" });
  }

  const invitationResponse = await db
    .from("arksa_community_invitations")
    .select("*")
    .eq("email", profile.email)
    .eq("status", "pending");
  for (const invitation of rows(invitationResponse.data, invitationResponse.error) as InvitationRow[]) {
    const { error: membershipError } = await db.from("arksa_community_memberships").upsert({
      id: randomUUID(),
      community_id: invitation.community_id,
      user_id: profile.user_id,
      role: "member",
      status: "active",
      permissions: permissions(invitation.permissions),
      joined_at: new Date().toISOString(),
    }, { onConflict: "community_id,user_id", ignoreDuplicates: true });
    if (membershipError) dbError(membershipError);
    const { error: claimError } = await db.from("arksa_community_invitations").update({
      status: "claimed",
      claimed_by: profile.user_id,
      claimed_at: new Date().toISOString(),
    }).eq("id", invitation.id).eq("status", "pending");
    if (claimError) dbError(claimError);
  }

  const adminSyncResponse = await db.rpc("arksa_sync_legacy_admins", { p_admin_emails: adminEmails });
  if (adminSyncResponse.error) dbError(adminSyncResponse.error);

  return viewerProfile(profileResponse.data as ProfileRow);
}

function viewerProfile(row: ProfileRow): ViewerProfile {
  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    arkAccountId: row.ark_account_id ?? null,
  };
}

export async function getViewerProfile(userId: string): Promise<ViewerProfile | undefined> {
  const { data, error } = await getSupabaseAdmin()
    .from("arksa_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return data ? viewerProfile(data as ProfileRow) : undefined;
}

export async function updateViewerArkAccountId(
  userId: string,
  arkAccountId: string | null,
): Promise<ViewerProfile> {
  const normalized = normalizeArkAccountId(arkAccountId);
  const { data, error } = await getSupabaseAdmin()
    .from("arksa_profiles")
    .update({ ark_account_id: normalized })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error?.code === "23505") {
    throw Object.assign(new Error("questo EOS/ARK ID è già collegato a un altro account Google"), {
      code: "COMMUNITY_CONFLICT",
    });
  }
  if (error || !data) dbError(error ?? { message: "profilo non trovato" });
  return viewerProfile(data as ProfileRow);
}

async function summariesFor(userId: string, query = ""): Promise<CommunitySummary[]> {
  const db = getSupabaseAdmin();
  const membershipResponse = await db.from("arksa_community_memberships").select("*").eq("user_id", userId);
  const memberships = rows(membershipResponse.data, membershipResponse.error) as MembershipRow[];
  const membershipIds = memberships.map((membership) => membership.community_id);

  let publicQuery = db.from("arksa_communities").select("*").eq("visibility", "public").eq("lifecycle", "active");
  if (query) publicQuery = publicQuery.ilike("search_text", `%${query}%`);
  const publicResponse = await publicQuery.order("created_at", { ascending: false }).limit(100);
  const communities = rows(publicResponse.data, publicResponse.error) as CommunityRow[];

  if (membershipIds.length > 0) {
    const ownResponse = await db.from("arksa_communities").select("*").in("id", membershipIds);
    for (const community of rows(ownResponse.data, ownResponse.error) as CommunityRow[]) {
      if (!communities.some((candidate) => candidate.id === community.id)) communities.push(community);
    }
  }

  const communityIds = communities.map((community) => community.id);
  if (communityIds.length === 0) return [];
  const [serverResponse, requestResponse] = await Promise.all([
    db.from("arksa_game_servers").select("*").in("community_id", communityIds),
    db.from("arksa_community_join_requests").select("*").eq("requester_user_id", userId).in("community_id", communityIds).order("created_at", { ascending: false }),
  ]);
  const servers = rows(serverResponse.data, serverResponse.error) as ServerRow[];
  const requests = rows(requestResponse.data, requestResponse.error) as JoinRequestRow[];

  return communities
    .filter((community) => !query || `${community.name} ${community.slug} ${community.description}`.toLocaleLowerCase("it-IT").includes(query))
    .map((community) => communitySummary(
      community,
      memberships.find((candidate) => candidate.community_id === community.id),
      requests.find((candidate) => candidate.community_id === community.id),
      servers.find((candidate) => candidate.community_id === community.id),
    ))
    .sort((a, b) => Number(!!b.membership) - Number(!!a.membership) || a.name.localeCompare(b.name, "it"));
}

export async function getViewer(userId: string): Promise<{ profile: ViewerProfile; communities: CommunitySummary[] }> {
  const { data, error } = await getSupabaseAdmin().from("arksa_profiles").select("*").eq("user_id", userId).single();
  if (error || !data) dbError(error ?? { message: "profilo non trovato" });
  const profile = data as ProfileRow;
  return {
    profile: viewerProfile(profile),
    communities: await summariesFor(userId),
  };
}

/** Directory privata della community, disponibile solo dopo la verifica della
 * membership nella rotta. Serve a selezionare collaboratori senza esporre
 * profili di utenti estranei alla community. */
export async function listCommunityMemberDirectory(
  communityId: string,
): Promise<CommunityMemberDirectoryEntry[]> {
  const db = getSupabaseAdmin();
  const membershipResponse = await db
    .from("arksa_community_memberships")
    .select("*")
    .eq("community_id", communityId)
    .eq("status", "active");
  const memberships = rows(membershipResponse.data, membershipResponse.error) as MembershipRow[];
  if (memberships.length === 0) return [];
  const profileResponse = await db
    .from("arksa_profiles")
    .select("*")
    .in("user_id", memberships.map((membership) => membership.user_id));
  const profiles = rows(profileResponse.data, profileResponse.error) as ProfileRow[];
  return memberships
    .map((membership) => {
      const profile = profiles.find((candidate) => candidate.user_id === membership.user_id);
      if (!profile) return null;
      return {
        ...viewerProfile(profile),
        membershipId: membership.id,
        role: membership.role,
      };
    })
    .filter((entry): entry is CommunityMemberDirectoryEntry => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

export async function listCommunities(userId: string, query = ""): Promise<CommunitySummary[]> {
  return summariesFor(userId, query);
}

export async function getCommunity(userId: string, communityId: string): Promise<CommunitySummary | undefined> {
  const locator = communityId.trim().toLowerCase();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(locator);
  const isSlug = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/.test(locator);
  if (!isUuid && !isSlug) return undefined;

  const db = getSupabaseAdmin();
  const communityResponse = await (isUuid
    ? db.from("arksa_communities").select("*").eq("id", locator).maybeSingle()
    : db.from("arksa_communities").select("*").eq("slug", locator).maybeSingle());
  if (communityResponse.error) dbError(communityResponse.error);
  if (!communityResponse.data) return undefined;
  const community = communityResponse.data as CommunityRow;
  const membership = await membershipFor(community.id, userId);
  if (!canOpenCommunityByLink(community, !!membership)) return undefined;

  const [serverResponse, requestResponse] = await Promise.all([
    db.from("arksa_game_servers").select("*").eq("community_id", community.id).maybeSingle(),
    db.from("arksa_community_join_requests")
      .select("*")
      .eq("community_id", community.id)
      .eq("requester_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (serverResponse.error) dbError(serverResponse.error);
  if (requestResponse.error) dbError(requestResponse.error);
  return communitySummary(
    community,
    membership,
    (requestResponse.data as JoinRequestRow | null) ?? undefined,
    (serverResponse.data as ServerRow | null) ?? undefined,
  );
}

export async function createCommunity(userId: string, input: CommunityCreateInput): Promise<CommunitySummary> {
  const db = getSupabaseAdmin();
  const validated = validateCommunityCreate(input);
  const ownedResponse = await db.from("arksa_community_memberships").select("id").eq("user_id", userId).eq("role", "owner").eq("status", "active").limit(1);
  if (rows(ownedResponse.data, ownedResponse.error).length > 0) {
    throw Object.assign(new Error("ogni utente può possedere una sola community"), { code: "COMMUNITY_LIMIT" });
  }

  const communityId = randomUUID();
  let slug = validated.slug;
  let inserted: CommunityRow | null = null;
  for (let attempt = 0; attempt < 2 && !inserted; attempt += 1) {
    const response = await db.from("arksa_communities").insert({
      id: communityId,
      ...validated,
      slug,
      join_policy: "request",
      // Diventa visibile soltanto dopo la creazione riuscita dell'owner.
      lifecycle: "draft",
      members_enabled: true,
      billing_exempt: false,
      legacy: false,
      created_by: userId,
    }).select("*").single();
    if (response.error?.code === "23505" && attempt === 0) {
      slug = uniqueCommunitySlug(validated.slug);
      continue;
    }
    if (response.error) dbError(response.error);
    inserted = response.data as CommunityRow;
  }
  if (!inserted) throw new Error("impossibile creare la community");

  const membershipResponse = await db.from("arksa_community_memberships").insert({
    id: randomUUID(),
    community_id: communityId,
    user_id: userId,
    role: "owner",
    status: "active",
    permissions: SAFE_MEMBER_PERMISSIONS,
  });
  if (membershipResponse.error) {
    await db.from("arksa_communities").delete().eq("id", communityId);
    dbError(membershipResponse.error);
  }
  const activationResponse = await db.from("arksa_communities").update({ lifecycle: "active" }).eq("id", communityId);
  if (activationResponse.error) {
    await db.from("arksa_community_memberships").delete().eq("community_id", communityId).eq("user_id", userId);
    await db.from("arksa_communities").delete().eq("id", communityId);
    dbError(activationResponse.error);
  }
  const created = await getCommunity(userId, communityId);
  if (!created) throw new Error("community creata ma non rileggibile");
  return created;
}

export async function updateCommunity(
  userId: string,
  communityId: string,
  patch: {
    name?: string;
    description?: string;
    visibility?: CommunityVisibility;
    joinPolicy?: "request" | "invite" | "closed";
  },
): Promise<CommunitySummary> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 3 || name.length > 80) {
      throw Object.assign(new Error("il nome della community deve contenere da 3 a 80 caratteri"), { code: "COMMUNITY_VALIDATION" });
    }
    update.name = name;
  }
  if (patch.description !== undefined) {
    const description = patch.description.trim();
    if (description.length > 600) {
      throw Object.assign(new Error("la descrizione non può superare 600 caratteri"), { code: "COMMUNITY_VALIDATION" });
    }
    update.description = description;
  }
  if (patch.visibility !== undefined) {
    if (!["public", "unlisted", "private"].includes(patch.visibility)) {
      throw Object.assign(new Error("visibilità non valida"), { code: "COMMUNITY_VALIDATION" });
    }
    update.visibility = patch.visibility;
  }
  if (patch.joinPolicy !== undefined) {
    if (!["request", "invite", "closed"].includes(patch.joinPolicy)) {
      throw Object.assign(new Error("politica di ingresso non valida"), { code: "COMMUNITY_VALIDATION" });
    }
    update.join_policy = patch.joinPolicy;
  }
  if (Object.keys(update).length > 0) {
    const { error } = await getSupabaseAdmin().from("arksa_communities").update(update).eq("id", communityId);
    if (error) dbError(error);
  }
  const community = await getCommunity(userId, communityId);
  if (!community) throw Object.assign(new Error("community non trovata"), { code: "COMMUNITY_NOT_FOUND" });
  return community;
}

export async function createJoinRequest(userId: string, communityId: string, message: string): Promise<CommunitySummary> {
  const db = getSupabaseAdmin();
  const community = await getCommunity(userId, communityId);
  if (!community || community.lifecycle !== "active" || community.visibility === "private") {
    throw Object.assign(new Error("community non disponibile"), { code: "COMMUNITY_NOT_FOUND" });
  }
  if (community.membership) throw Object.assign(new Error("sei già membro della community"), { code: "COMMUNITY_CONFLICT" });
  if (community.joinPolicy !== "request") throw Object.assign(new Error("questa community non accetta richieste"), { code: "COMMUNITY_CONFLICT" });
  if (message.length > 500) throw Object.assign(new Error("il messaggio non può superare 500 caratteri"), { code: "COMMUNITY_VALIDATION" });
  const { error } = await db.from("arksa_community_join_requests").insert({
    id: randomUUID(),
    community_id: community.id,
    requester_user_id: userId,
    message: message.trim(),
    status: "pending",
  });
  if (error?.code === "23505") throw Object.assign(new Error("hai già una richiesta in attesa"), { code: "COMMUNITY_CONFLICT" });
  if (error) dbError(error);
  return (await getCommunity(userId, community.id))!;
}

export async function cancelJoinRequest(userId: string, communityId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().from("arksa_community_join_requests")
    .update({ status: "cancelled", reviewed_at: new Date().toISOString() })
    .eq("community_id", communityId)
    .eq("requester_user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) dbError(error);
  return !!data;
}

export async function listJoinRequests(communityId: string, reviewerId: string): Promise<CommunityJoinRequest[]> {
  await requireReviewer(communityId, reviewerId);
  const db = getSupabaseAdmin();
  const requestResponse = await db.from("arksa_community_join_requests").select("*").eq("community_id", communityId).order("created_at", { ascending: false });
  const requests = rows(requestResponse.data, requestResponse.error) as JoinRequestRow[];
  const userIds = [...new Set(requests.map((request) => request.requester_user_id))];
  const profileResponse = userIds.length > 0
    ? await db.from("arksa_profiles").select("*").in("user_id", userIds)
    : { data: [], error: null };
  const profiles = rows(profileResponse.data, profileResponse.error) as ProfileRow[];
  return requests.map((request) => {
    const profile = profiles.find((candidate) => candidate.user_id === request.requester_user_id)!;
    return {
      id: request.id,
      communityId: request.community_id,
      requester: {
        id: request.requester_user_id,
        email: profile?.email ?? "",
        name: profile?.name ?? "Utente",
        avatarUrl: profile?.avatar_url ?? null,
        arkAccountId: profile?.ark_account_id ?? null,
      },
      message: request.message,
      status: request.status,
      createdAt: request.created_at,
      reviewedAt: request.reviewed_at,
    };
  });
}

export async function reviewJoinRequest(
  communityId: string,
  requestId: string,
  reviewerId: string,
  decision: "approved" | "rejected",
  note = "",
): Promise<void> {
  await requireReviewer(communityId, reviewerId);
  const db = getSupabaseAdmin();
  const response = await db.from("arksa_community_join_requests").update({
    status: decision,
    reviewer_user_id: reviewerId,
    review_note: note.trim() || null,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId).eq("community_id", communityId).eq("status", "pending").select("*").maybeSingle();
  if (response.error) dbError(response.error);
  const request = response.data as JoinRequestRow | null;
  if (!request) throw Object.assign(new Error("richiesta non trovata o già revisionata"), { code: "COMMUNITY_CONFLICT" });
  if (decision === "approved") {
    const membershipResponse = await db.from("arksa_community_memberships").upsert({
      id: randomUUID(),
      community_id: communityId,
      user_id: request.requester_user_id,
      role: "member",
      status: "active",
      permissions: SAFE_MEMBER_PERMISSIONS,
    }, { onConflict: "community_id,user_id", ignoreDuplicates: true });
    if (membershipResponse.error) {
      await db.from("arksa_community_join_requests").update({
        status: "pending",
        reviewer_user_id: null,
        review_note: null,
        reviewed_at: null,
      }).eq("id", request.id).eq("status", "approved");
      dbError(membershipResponse.error);
    }
  }
}

export async function getServerCommunityAccess(communityId: string, userId: string): Promise<ServerCommunityAccess | undefined> {
  const db = getSupabaseAdmin();
  const [communityResponse, membershipResponse, serverResponse] = await Promise.all([
    db.from("arksa_communities").select("*").eq("id", communityId).maybeSingle(),
    db.from("arksa_community_memberships").select("*").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("arksa_game_servers").select("*").eq("community_id", communityId).maybeSingle(),
  ]);
  if (communityResponse.error) dbError(communityResponse.error);
  if (membershipResponse.error) dbError(membershipResponse.error);
  if (serverResponse.error) dbError(serverResponse.error);
  if (!communityResponse.data || !membershipResponse.data || !serverResponse.data) return undefined;
  return {
    community: communityResponse.data as CommunityRow,
    membership: membershipResponse.data as MembershipRow,
    server: serverResponse.data as ServerRow,
  };
}

export async function listCommunityFriends(communityId: string): Promise<{ friendsEnabled: boolean; accounts: FriendAccount[] }> {
  const db = getSupabaseAdmin();
  const [communityResponse, membershipResponse, invitationResponse] = await Promise.all([
    db.from("arksa_communities").select("members_enabled").eq("id", communityId).single(),
    db.from("arksa_community_memberships").select("*").eq("community_id", communityId).neq("role", "owner"),
    db.from("arksa_community_invitations").select("*").eq("community_id", communityId).eq("status", "pending"),
  ]);
  if (communityResponse.error) dbError(communityResponse.error);
  const memberships = rows(membershipResponse.data, membershipResponse.error) as MembershipRow[];
  const invitations = rows(invitationResponse.data, invitationResponse.error) as InvitationRow[];
  const profileResponse = memberships.length > 0
    ? await db.from("arksa_profiles").select("*").in("user_id", memberships.map((membership) => membership.user_id))
    : { data: [], error: null };
  const profiles = rows(profileResponse.data, profileResponse.error) as ProfileRow[];
  const accounts: FriendAccount[] = memberships.map((membership) => {
    const profile = profiles.find((candidate) => candidate.user_id === membership.user_id);
    return {
      id: membership.id,
      email: profile?.email ?? "",
      name: profile?.name ?? profile?.email?.split("@")[0] ?? "Membro",
      avatarUrl: profile?.avatar_url ?? null,
      arkAccountId: profile?.ark_account_id ?? null,
      authUserId: membership.user_id,
      permissions: permissions(membership.permissions),
      disabled: membership.status === "suspended",
      status: "accepted",
      authorizedAt: membership.joined_at,
      lastUsedAt: membership.last_used_at,
      communityRole: membership.role === "owner" ? "member" : membership.role,
    };
  });
  for (const invitation of invitations) {
    accounts.push({
      id: invitation.id,
      email: invitation.email,
      name: invitation.email.split("@")[0] || invitation.email,
      avatarUrl: null,
      arkAccountId: null,
      authUserId: null,
      permissions: permissions(invitation.permissions),
      disabled: false,
      status: "pending",
      authorizedAt: invitation.created_at,
      lastUsedAt: null,
      communityRole: "member",
    });
  }
  return { friendsEnabled: !!communityResponse.data.members_enabled, accounts };
}

export async function inviteCommunityFriend(
  communityId: string,
  email: string,
  initialPermissions: Partial<FriendPermissions> = {},
): Promise<FriendAccount> {
  const db = getSupabaseAdmin();
  const normalizedEmail = email.trim().toLowerCase();
  const [profileResponse, existingInvitationResponse] = await Promise.all([
    db.from("arksa_profiles").select("*").eq("email", normalizedEmail).maybeSingle(),
    db.from("arksa_community_invitations")
      .select("*")
      .eq("community_id", communityId)
      .eq("email", normalizedEmail)
      .maybeSingle(),
  ]);
  if (profileResponse.error) dbError(profileResponse.error);
  if (existingInvitationResponse.error) dbError(existingInvitationResponse.error);
  if (profileResponse.data) {
    const profile = profileResponse.data as ProfileRow;
    const membershipResponse = await db.from("arksa_community_memberships").insert({
      id: randomUUID(),
      community_id: communityId,
      user_id: profile.user_id,
      role: "member",
      status: "active",
      permissions: { ...SAFE_MEMBER_PERMISSIONS, ...initialPermissions },
    }).select("*").single();
    if (membershipResponse.error?.code === "23505") throw Object.assign(new Error("questo utente appartiene già alla community"), { code: "DUPLICATE_EMAIL" });
    if (membershipResponse.error) dbError(membershipResponse.error);
    if (existingInvitationResponse.data) {
      const { error } = await db.from("arksa_community_invitations").update({
        status: "claimed",
        claimed_by: profile.user_id,
        claimed_at: new Date().toISOString(),
      }).eq("id", existingInvitationResponse.data.id);
      if (error) dbError(error);
    }
    return (await listCommunityFriends(communityId)).accounts.find((account) => account.authUserId === profile.user_id)!;
  }
  if (existingInvitationResponse.data) {
    const { error } = await db.from("arksa_community_invitations").update({
      permissions: { ...SAFE_MEMBER_PERMISSIONS, ...initialPermissions },
      status: "pending",
      claimed_by: null,
      claimed_at: null,
    }).eq("id", existingInvitationResponse.data.id);
    if (error) dbError(error);
    return (await listCommunityFriends(communityId)).accounts.find((account) => account.id === existingInvitationResponse.data.id)!;
  }
  const invitationResponse = await db.from("arksa_community_invitations").insert({
    id: randomUUID(),
    community_id: communityId,
    email: normalizedEmail,
    permissions: { ...SAFE_MEMBER_PERMISSIONS, ...initialPermissions },
    status: "pending",
  }).select("*").single();
  if (invitationResponse.error?.code === "23505") throw Object.assign(new Error("questa email è già autorizzata"), { code: "DUPLICATE_EMAIL" });
  if (invitationResponse.error) dbError(invitationResponse.error);
  return (await listCommunityFriends(communityId)).accounts.find((account) => account.id === invitationResponse.data.id)!;
}

export async function updateCommunityFriend(
  communityId: string,
  id: string,
  patch: { permissions?: Partial<FriendPermissions>; disabled?: boolean; role?: "admin" | "moderator" | "member" },
): Promise<FriendAccount | undefined> {
  const db = getSupabaseAdmin();
  const current = (await listCommunityFriends(communityId)).accounts.find((account) => account.id === id);
  if (!current) return undefined;
  if (current.authUserId) {
    const update: Record<string, unknown> = {};
    if (patch.permissions) update.permissions = { ...current.permissions, ...patch.permissions };
    if (patch.disabled !== undefined) update.status = patch.disabled ? "suspended" : "active";
    if (patch.role) update.role = patch.role;
    const { error } = await db.from("arksa_community_memberships").update(update).eq("id", id).eq("community_id", communityId).neq("role", "owner");
    if (error) dbError(error);
  } else {
    const update: Record<string, unknown> = {};
    if (patch.permissions) update.permissions = { ...current.permissions, ...patch.permissions };
    if (patch.disabled !== undefined) update.status = patch.disabled ? "revoked" : "pending";
    const { error } = await db.from("arksa_community_invitations").update(update).eq("id", id).eq("community_id", communityId);
    if (error) dbError(error);
  }
  return (await listCommunityFriends(communityId)).accounts.find((account) => account.id === id);
}

export async function deleteCommunityFriend(communityId: string, id: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  const membershipResponse = await db.from("arksa_community_memberships").delete().eq("id", id).eq("community_id", communityId).neq("role", "owner").select("id").maybeSingle();
  if (membershipResponse.error) dbError(membershipResponse.error);
  if (membershipResponse.data) return true;
  const invitationResponse = await db.from("arksa_community_invitations").delete().eq("id", id).eq("community_id", communityId).select("id").maybeSingle();
  if (invitationResponse.error) dbError(invitationResponse.error);
  return !!invitationResponse.data;
}

export async function setCommunityMembersEnabled(communityId: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabaseAdmin().from("arksa_communities").update({ members_enabled: enabled }).eq("id", communityId);
  if (error) dbError(error);
}
