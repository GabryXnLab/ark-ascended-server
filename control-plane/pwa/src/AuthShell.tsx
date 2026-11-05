import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AlertTriangle, LoaderCircle, LogIn, Mountain, Power, ShieldCheck, UsersRound } from "lucide-react";
import { App } from "./App";
import { api } from "./api";
import { getAuthClient, signInWithGoogle, signOut } from "./auth";

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-ambient" aria-hidden="true" />
      <div className="card auth-card">{children}</div>
    </main>
  );
}

function Login() {
  const [error, setError] = useState<string | null>(null);
  return (
    <CenterCard>
      <div className="auth-logo"><Mountain size={30} /></div>
      <span className="eyebrow auth-eyebrow">Il tuo ARK, quando serve</span>
      <h1>ARK On-demand</h1>
      <p className="muted auth-lead">Ritrova la tua community, accendi il server e raggiungi il mondo condiviso da qualsiasi dispositivo.</p>
      <div className="auth-benefits" aria-label="Funzioni principali">
        <span><Power size={15} /> Avvio controllato</span>
        <span><UsersRound size={15} /> Community condivise</span>
        <span><ShieldCheck size={15} /> Accesso protetto</span>
      </div>
      {error && <div className="banner banner-error" role="alert"><AlertTriangle size={16} />{error}</div>}
      <button className="btn auth-google-btn" onClick={() => signInWithGoogle(window.location.origin).catch((e) => setError(String(e)))}>
        <LogIn size={18} /> Continua con Google
      </button>
      <p className="auth-privacy">L’accesso usa Google tramite Supabase. Le credenziali non vengono condivise con il server di gioco.</p>
    </CenterCard>
  );
}

function AccessError({ message }: { message: string }) {
  return (
    <CenterCard>
      <div className="auth-logo auth-logo-error"><AlertTriangle size={28} /></div>
      <h1>Impossibile inizializzare il profilo</h1>
      <p className="muted">{message}</p>
      <p className="small muted">Ogni account Google è ammesso: questo errore indica un problema temporaneo di configurazione o persistenza.</p>
      <button className="btn-secondary w-full mt-16" onClick={() => signOut().then(() => window.location.reload())}>Cambia account Google</button>
    </CenterCard>
  );
}

export function AuthShell() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [accessError, setAccessError] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void getAuthClient().then(async (client) => {
      setSession((await client.auth.getSession()).data.session);
      const { data } = client.auth.onAuthStateChange((_event, next) => { setSession(next); setAccessError(next ? undefined : null); });
      unsubscribe = () => data.subscription.unsubscribe();
    }).catch((e) => setAccessError(e instanceof Error ? e.message : String(e)));
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (session) void api.viewer().then(() => setAccessError(null)).catch((e) => setAccessError(e instanceof Error ? e.message : String(e)));
  }, [session]);

  if (accessError) return <AccessError message={accessError} />;
  if (session === undefined) return <CenterCard><div className="auth-loader"><LoaderCircle size={24} /><p className="muted">Caricamento dell’app…</p></div></CenterCard>;
  if (!session) return <Login />;
  if (accessError === undefined) return <CenterCard><div className="auth-loader"><LoaderCircle size={24} /><p className="muted">Verifica dell’accesso…</p></div></CenterCard>;
  return <App />;
}
