import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

interface AuthConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

let clientPromise: Promise<SupabaseClient> | undefined;

export function getAuthClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = fetch("/api/auth/config")
      .then(async (response) => {
        if (!response.ok) throw new Error("Configurazione autenticazione non disponibile");
        return response.json() as Promise<AuthConfig>;
      })
      .then(({ supabaseUrl, supabasePublishableKey }) => {
        if (!supabaseUrl || !supabasePublishableKey) throw new Error("Supabase non configurato sul server");
        return createClient(supabaseUrl, supabasePublishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
      });
  }
  return clientPromise;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await (await getAuthClient()).auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getAccessToken(): Promise<string> {
  return (await getSession())?.access_token ?? "";
}

export async function signInWithGoogle(redirectTo = window.location.href): Promise<void> {
  const { error } = await (await getAuthClient()).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await (await getAuthClient()).auth.signOut();
  if (error) throw error;
}
