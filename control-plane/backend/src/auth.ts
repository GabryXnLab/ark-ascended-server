// Supabase verifica il JWT della sessione; l'accesso applicativo viene poi
// risolto per email Google (admin configurato) o membership accettata.

import type { Request, Response, NextFunction } from "express";
import { getSupabaseAdmin } from "./supabase.js";
import type { CommunityRole, FriendPermissions } from "./community-model.js";

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

interface AccountIdentity {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type Account =
  | (AccountIdentity & { role: "admin" })
  | (AccountIdentity & { role: "friend"; permissions: FriendPermissions });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      account?: Account;
      googleUser?: GoogleUser;
      communityRole?: CommunityRole;
      communityId?: string;
      communityServerId?: string;
    }
  }
}

function bearer(req: Request): string {
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function normalizeGoogleName(value: unknown, email: string): string {
  const fallback = email.split("@")[0]?.trim() || "Utente";
  const candidate = typeof value === "string" ? value.trim() : "";
  return (candidate || fallback).slice(0, 120);
}

async function readGoogleUser(req: Request): Promise<GoogleUser | undefined> {
  const token = bearer(req);
  if (!token) return undefined;
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  const user = data.user;
  const providers = new Set([user?.app_metadata?.provider, ...(user?.app_metadata?.providers ?? [])]);
  if (error || !user?.email || !providers.has("google")) return undefined;
  return {
    id: user.id,
    email: user.email.toLowerCase(),
    name: normalizeGoogleName(user.user_metadata?.full_name ?? user.user_metadata?.name, user.email),
    avatarUrl: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
  };
}

export async function authenticateGoogle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    req.googleUser = await readGoogleUser(req);
    if (!req.googleUser) return void res.status(401).json({ error: "sessione Google non valida o scaduta" });
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(name: keyof FriendPermissions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const account = req.account;
    if (!account) return void res.status(401).json({ error: "non autorizzato" });
    if (account.role === "admin") return next();
    if (!account.permissions[name]) return void res.status(403).json({ error: `permesso '${name}' non concesso dall'amministratore` });
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.account?.role !== "admin") return void res.status(403).json({ error: "riservato all'amministratore" });
  next();
}
