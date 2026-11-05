import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

function required(value: string, name: string): string {
  if (!value) throw new Error(`${name} non configurato`);
  return value;
}

// Lo schema nasce dalla migration nello stesso repository; senza i tipi generati
// da un progetto remoto collegato Supabase inferirebbe ogni insert/update come
// `never`. Il boundary non tipizzato resta confinato in questo modulo e i record
// vengono convertiti nei tipi applicativi negli store (es. communities-store.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;

/** Client privilegiato, usato soltanto dal backend. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseAdmin(): any {
  if (!client) {
    client = createClient(
      required(config.supabaseUrl, "SUPABASE_URL"),
      required(config.supabaseSecretKey, "SUPABASE_SECRET_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  return client;
}

export function assertAuthConfigured(): void {
  required(config.supabaseUrl, "SUPABASE_URL");
  required(config.supabasePublishableKey, "SUPABASE_PUBLISHABLE_KEY");
  required(config.supabaseSecretKey, "SUPABASE_SECRET_KEY");
  if (config.adminEmails.length === 0) throw new Error("ADMIN_EMAILS non configurato");
}
