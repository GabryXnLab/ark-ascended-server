import { useEffect, useState } from "react";
import { LogOut, Save, Check, ShieldCheck, Users, SlidersHorizontal, AlertTriangle, Gamepad2, Unlink } from "lucide-react";
import { api } from "../api";
import { signOut } from "../auth";
import type { CommunitySummary, Me, Status } from "../types";
import { Administration } from "./Administration";

const ARK_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9]{32}$/;

export function Settings({ status, me, community, onProfileChange }: {
  status: Status | null;
  me: Me | null;
  community: CommunitySummary;
  onProfileChange: () => Promise<void>;
}) {
  const [section, setSection] = useState<"general" | "admin">("general");

  const [arkAccountId, setArkAccountId] = useState("");
  const [arkIdBusy, setArkIdBusy] = useState(false);
  const [arkIdErr, setArkIdErr] = useState<string | null>(null);
  const [arkIdSaved, setArkIdSaved] = useState(false);

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    setArkAccountId(me?.arkAccountId ?? "");
  }, [me?.arkAccountId]);

  async function saveArkAccountId() {
    const normalized = arkAccountId.trim();
    if (normalized && !ARK_ACCOUNT_ID_PATTERN.test(normalized)) {
      setArkIdErr("L'EOS/ARK ID deve contenere esattamente 32 caratteri alfanumerici.");
      return;
    }
    setArkIdBusy(true); setArkIdErr(null); setArkIdSaved(false);
    try {
      await api.profile.setArkAccountId(normalized || null);
      await onProfileChange();
      setArkIdSaved(true);
    } catch (error) {
      setArkIdErr(error instanceof Error ? error.message : String(error));
    } finally {
      setArkIdBusy(false);
    }
  }

  return (
    <div className="grid">
      {isAdmin && (
        <div className="row-center settings-switch">
          <button
            className={section === "general" ? "btn" : "btn-secondary"}
            onClick={() => setSection("general")}
          >
            <SlidersHorizontal size={16} /> Generali
          </button>
          <button
            className={section === "admin" ? "btn" : "btn-secondary"}
            onClick={() => setSection("admin")}
          >
            <ShieldCheck size={16} /> Amministrazione
          </button>
        </div>
      )}

      {isAdmin && me && section === "admin" && <Administration me={me} status={status} community={community} />}

      {(!isAdmin || section === "general") && (
      <>
      {me && (
        <section className="card">
          <h2>
            {me.role === "admin" ? <ShieldCheck size={16} /> : <Users size={16} />} Account
          </h2>
          <div className="kv">
            <span>Ruolo</span>
            <b className="small">
              {me.communityRole === "owner" ? "Titolare"
                : me.communityRole === "admin" ? "Amministratore"
                  : me.communityRole === "moderator" ? "Moderatore"
                    : "Membro"}
            </b>
          </div>
          {me.role === "friend" && (
            <div className="kv">
              <span>Nome</span>
              <b className="small">{me.name}</b>
            </div>
          )}
          <div className="kv">
            <span>Email Google</span>
            <b className="small">{me.email}</b>
          </div>
          <div className="account-link-panel">
            <label>
              <span className="row-center" style={{ gap: "7px" }}><Gamepad2 size={15} /> EOS/ARK ID personale</span>
              <input
                className="admin-account-input"
                value={arkAccountId}
                maxLength={32}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="0123456789abcdef0123456789abcdef"
                onChange={(event) => {
                  setArkAccountId(event.target.value.trim());
                  setArkIdSaved(false);
                  setArkIdErr(null);
                }}
              />
            </label>
            <p className="muted small mt-8">
              Collega questo account Google al tuo giocatore in ARK. Lo trovi nella console di ASA con <code>whoami</code>.
            </p>
            {arkIdErr && <div className="banner banner-error mt-8"><AlertTriangle size={15} /><span>{arkIdErr}</span></div>}
            {arkIdSaved && <div className="banner banner-ok mt-8"><Check size={15} /><span>Account Google e giocatore ARK collegati.</span></div>}
            {(arkAccountId || me.arkAccountId) && (
              <button
                className="btn-secondary w-full mt-12"
                disabled={
                  arkIdBusy
                  || arkAccountId === (me.arkAccountId ?? "")
                  || (!!arkAccountId && !ARK_ACCOUNT_ID_PATTERN.test(arkAccountId))
                }
                onClick={() => void saveArkAccountId()}
              >
                {arkAccountId ? <Save size={16} /> : <Unlink size={16} />} {arkAccountId ? "Salva EOS/ARK ID" : "Rimuovi collegamento"}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="card">
        <h2><ShieldCheck size={16} /> Accesso Google</h2>
        <p className="muted small">La sessione è protetta e rinnovata da Supabase Auth. Nessun token deve essere copiato o condiviso.</p>
        <button className="btn-secondary w-full mt-16" onClick={() => void signOut().then(() => window.location.reload())}><LogOut size={16} /> Esci</button>
      </section>

      </>
      )}
    </div>
  );
}
