import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, ClipboardList, UserPlus, Trash2,
  CheckCircle2, XCircle, AlertCircle, Ban, ShieldCheck, Plus, Pencil,
  Boxes, Puzzle, Save, ChevronRight, Gamepad2, KeyRound, Radio, Globe2,
} from "lucide-react";
import { api } from "../api";
import type {
  AdminWhitelistState,
  CommunityJoinRequest,
  CommunitySummary,
  FriendAccount,
  FriendPermissions,
  GameConfiguration,
  Me,
  PendingRequest,
  Status,
} from "../types";
import { ModLibrary } from "./ModLibrary";
import { SavegamesLibrary } from "./SavegamesLibrary";

const PERMISSION_LABELS: Record<keyof FriendPermissions, string> = {
  power: "Accensione / spegnimento",
  timer: "Timer auto-stop",
  applyConfig: "Carica o riavvia una configurazione",
};
const PERMISSION_KEYS: Array<keyof FriendPermissions> = ["power", "timer", "applyConfig"];

// Stessi default del backend (SAFE_MEMBER_PERMISSIONS): un membro nuovo può solo
// accendere/spegnere, tutto il resto va concesso esplicitamente.
const DEFAULT_NEW_PERMISSIONS: FriendPermissions = {
  power: true,
  timer: false,
  applyConfig: false,
};

/**
 * Per le richieste "config" un'unica riga non basta a capire se è una configurazione
 * nuova o una modifica, né cosa cambia rispetto a quella attuale: qui si confronta il
 * payload proposto con la configurazione esistente (se referenziata da id) per mostrare
 * all'admin un diff leggibile invece del solo payload grezzo.
 */
function summarizeConfigRequest(
  r: PendingRequest,
  configs: GameConfiguration[],
): { isNew: boolean; targetName: string; lines: string[] } {
  const p = r.payload as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id : undefined;
  const existing = id ? configs.find((c) => c.id === id) : undefined;
  const name = String(p.name ?? "");
  const map = String(p.map ?? "");
  const mods = Array.isArray(p.mods) ? (p.mods as number[]) : [];
  const iniOverrides = p.iniOverrides as GameConfiguration["iniOverrides"] | undefined;
  const lines: string[] = [];

  if (!existing) {
    lines.push(`Mappa: ${map || "—"}`);
    lines.push(`Mod: ${mods.length > 0 ? mods.join(", ") : "nessuna"}`);
    const iniCount = iniOverrides
      ? Object.keys(iniOverrides.gus?.values ?? {}).length + Object.keys(iniOverrides.game?.values ?? {}).length
      : 0;
    if (iniCount > 0) lines.push(`Parametri di gioco: ${iniCount} valore/i personalizzato/i`);
    const rawLines = [iniOverrides?.gus?.raw, iniOverrides?.game?.raw]
      .filter((raw): raw is string => typeof raw === "string")
      .flatMap((raw) => raw.split(/\r?\n/).filter((line) => line.trim()));
    if (rawLines.length > 0) lines.push(`Direttive INI avanzate: ${rawLines.length} riga/he`);
    const launchCount = iniOverrides?.launchArgs?.split(/\r?\n/).filter((line) => line.trim()).length ?? 0;
    if (launchCount > 0) lines.push(`Argomenti ASA avanzati: ${launchCount}`);
    return { isNew: true, targetName: name, lines };
  }

  if (existing.name !== name) lines.push(`Nome: "${existing.name}" → "${name}"`);
  if (existing.map !== map) lines.push(`Mappa: "${existing.map}" → "${map}"`);

  const oldMods = new Set(existing.mods);
  const newMods = new Set(mods);
  const added = mods.filter((m) => !oldMods.has(m));
  const removed = existing.mods.filter((m) => !newMods.has(m));
  if (added.length > 0) lines.push(`Mod aggiunti: ${added.join(", ")}`);
  if (removed.length > 0) lines.push(`Mod rimossi: ${removed.join(", ")}`);

  const oldValues = { ...existing.iniOverrides.gus.values, ...existing.iniOverrides.game.values };
  const newValues = { ...(iniOverrides?.gus?.values ?? {}), ...(iniOverrides?.game?.values ?? {}) };
  const changedKeys = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])].filter(
    (k) => oldValues[k] !== newValues[k],
  );
  if (changedKeys.length > 0) {
    lines.push(`Parametri di gioco modificati: ${changedKeys.slice(0, 6).join(", ")}${changedKeys.length > 6 ? "…" : ""}`);
  }
  if ((existing.iniOverrides.gus.raw ?? "") !== (iniOverrides?.gus?.raw ?? "")
    || (existing.iniOverrides.game.raw ?? "") !== (iniOverrides?.game?.raw ?? "")) {
    lines.push("Direttive INI avanzate modificate");
  }
  if ((existing.iniOverrides.launchArgs ?? "") !== (iniOverrides?.launchArgs ?? "")) {
    lines.push("Argomenti di avvio ASA modificati");
  }

  if (lines.length === 0) lines.push("Nessuna differenza rilevata rispetto alla configurazione attuale.");

  return { isNew: false, targetName: existing.name, lines };
}

type ComponentsView = "menu" | "mods" | "saves";
type AdministrationSection = "reviews" | "friends" | "community" | "gameAdmins" | "components";
const ADMIN_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9]{32}$/;

export function Administration({ me, status, community }: { me: Me; status: Status | null; community: CommunitySummary }) {
  const [section, setSection] = useState<AdministrationSection>("reviews");
  const [componentsView, setComponentsView] = useState<ComponentsView>("menu");
  const [friendsEnabled, setFriendsEnabledState] = useState(true);
  const [friends, setFriends] = useState<FriendAccount[]>([]);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [joinRequests, setJoinRequests] = useState<CommunityJoinRequest[]>([]);
  const [profileName, setProfileName] = useState(community.name);
  const [profileDescription, setProfileDescription] = useState(community.description);
  const [profileVisibility, setProfileVisibility] = useState(community.visibility);
  const [configs, setConfigs] = useState<GameConfiguration[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPerms, setNewPerms] = useState<FriendPermissions>({ ...DEFAULT_NEW_PERMISSIONS });
  const [adminWhitelist, setAdminWhitelist] = useState<AdminWhitelistState | null>(null);
  const [newAdminAccountId, setNewAdminAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const pendingCount = useMemo(() => requests.filter((r) => r.status === "pending").length, [requests]);
  const pendingJoinRequests = useMemo(() => joinRequests.filter((r) => r.status === "pending"), [joinRequests]);
  const canManageRoles = me.role === "admin" && me.communityRole === "owner";

  const load = useCallback(async () => {
    try {
      const [f, r, c, whitelist, joins] = await Promise.all([
        api.friends.list(),
        api.requests.list(),
        api.configs.list(),
        api.adminWhitelist.get(),
        api.communities.requests(community.id),
      ]);
      setJoinRequests(joins);
      setFriends(f.accounts);
      setFriendsEnabledState(f.friendsEnabled);
      setRequests(r);
      setConfigs(c);
      setAdminWhitelist(whitelist);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [community.id]);

  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); if (ok) setMsg(ok); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); await load(); }
    finally { setBusy(false); }
  }

  async function toggleFriendsEnabled() {
    if (friendsEnabled && !window.confirm("Disattivare l'accesso di tutti i membri? Nessun membro non amministratore potrà usare il pannello finché non lo riattivi.")) return;
    await run(() => api.access.set(!friendsEnabled));
  }

  async function reviewJoinRequest(request: CommunityJoinRequest, decision: "approve" | "reject") {
    await run(
      () => decision === "approve"
        ? api.communities.approve(community.id, request.id)
        : api.communities.reject(community.id, request.id),
      decision === "approve" ? `${request.requester.name} è entrato nella community.` : "Richiesta di ingresso rifiutata.",
    );
  }

  async function saveCommunityProfile() {
    await run(
      () => api.communities.update(community.id, {
        name: profileName,
        description: profileDescription,
        visibility: profileVisibility,
      }),
      "Profilo community aggiornato.",
    );
  }

  async function createFriend() {
    const email = newEmail.trim();
    if (!email) return;
    await run(async () => {
      await api.friends.create(email, newPerms);
      setNewEmail("");
      setNewPerms({ ...DEFAULT_NEW_PERMISSIONS });
    }, `${email} è ora autorizzata.`);
  }

  async function togglePermission(id: string, key: keyof FriendPermissions, value: boolean) {
    await run(() => api.friends.update(id, { permissions: { [key]: value } }));
  }

  async function toggleDisabled(id: string, disabled: boolean) {
    await run(() => api.friends.update(id, { disabled }));
  }

  async function changeRole(id: string, role: "admin" | "moderator" | "member") {
    await run(() => api.friends.update(id, { role }), "Ruolo community aggiornato.");
  }

  async function remove(friend: FriendAccount) {
    if (!window.confirm(`Rimuovere ${friend.name} (${friend.email}) dalla community? Perderà subito l'accesso al pannello.`)) return;
    await run(() => api.friends.remove(friend.id), "Membro rimosso.");
  }

  async function approve(id: string) {
    await run(
      () => api.requests.approve(id),
      "Revisione approvata: la configurazione è salvata. Se è quella in esecuzione, riavvia il gioco dalla tab Stato.",
    );
  }

  async function reject(id: string) {
    await run(() => api.requests.reject(id), "Revisione rifiutata.");
  }

  async function persistAdminWhitelist(accountIds: string[], successMessage?: string) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const result = await api.adminWhitelist.set(accountIds);
      setAdminWhitelist(result);
      setMsg(result.queued
        ? "Whitelist salvata: verrà applicata prima dell'avvio di ASA alla prossima accensione."
        : successMessage ?? "Whitelist scritta sul game server. ASA la recepirà al prossimo aggiornamento della lista amministratori.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addAdminAccountId(id: string, playerName?: string) {
    const normalized = id.trim();
    if (!ADMIN_ACCOUNT_ID_PATTERN.test(normalized)) {
      setErr("L'EOS/ARK ID deve contenere esattamente 32 caratteri alfanumerici.");
      return;
    }
    const current = adminWhitelist?.accountIds ?? [];
    if (current.includes(normalized)) {
      setErr("Questo account è già presente nella whitelist.");
      return;
    }
    await persistAdminWhitelist(
      [...current, normalized],
      playerName ? `${playerName} è stato aggiunto agli amministratori di gioco.` : undefined,
    );
    setNewAdminAccountId("");
  }

  async function removeAdminAccountId(id: string) {
    if (!window.confirm(`Togliere i privilegi di amministratore nel gioco all'account ${id}?`)) return;
    await persistAdminWhitelist(
      (adminWhitelist?.accountIds ?? []).filter((candidate) => candidate !== id),
      "Account rimosso dalla whitelist amministratori.",
    );
  }

  const detectedPlayers = (status?.ark?.players ?? []).filter(
    (player) => ADMIN_ACCOUNT_ID_PATTERN.test(player.id),
  );

  if (section === "components" && componentsView !== "menu") {
    const back = () => setComponentsView("menu");
    if (componentsView === "mods") return <ModLibrary onClose={back} />;
    return <SavegamesLibrary onClose={back} />;
  }

  return (
    <div className="grid">
      {err && (
        <div className="banner banner-error" role="alert">
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{err}</span>
        </div>
      )}
      {msg && (
        <div className="banner banner-ok" role="status">
          <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
          <span>{msg}</span>
        </div>
      )}

      <section className="card access-control-card">
        <h2>
          <ShieldCheck size={16} /> Accesso membri
        </h2>
        <p className="muted small mt-8">
          Interruttore generale: se disattivato, nessun membro può usare il pannello indipendentemente
          dai permessi individuali. L'amministratore non è mai limitato.
        </p>
        <button
          className={friendsEnabled ? "btn-secondary w-full mt-16" : "btn w-full mt-16"}
          disabled={busy}
          onClick={toggleFriendsEnabled}
        >
          <Ban size={16} />
          {friendsEnabled ? "Disattiva tutti i membri" : "Riattiva accesso membri"}
        </button>
      </section>

      <div className="admin-tabs" role="group" aria-label="Sezioni amministrazione">
        <button
          className={section === "reviews" ? "btn" : "btn-secondary"}
          aria-pressed={section === "reviews"}
          onClick={() => setSection("reviews")}
        >
          <ClipboardList size={16} /> Revisioni config {pendingCount > 0 && `(${pendingCount})`}
        </button>
        <button
          className={section === "friends" ? "btn" : "btn-secondary"}
          aria-pressed={section === "friends"}
          onClick={() => setSection("friends")}
        >
          <Users size={16} /> Membri {pendingJoinRequests.length > 0 && `(${pendingJoinRequests.length})`}
        </button>
        <button
          className={section === "community" ? "btn" : "btn-secondary"}
          aria-pressed={section === "community"}
          onClick={() => setSection("community")}
        >
          <Globe2 size={16} /> Community
        </button>
        <button
          className={section === "gameAdmins" ? "btn" : "btn-secondary"}
          aria-pressed={section === "gameAdmins"}
          onClick={() => setSection("gameAdmins")}
        >
          <Gamepad2 size={16} /> Admin ARK
        </button>
        <button
          className={section === "components" ? "btn" : "btn-secondary"}
          aria-pressed={section === "components"}
          onClick={() => { setSection("components"); setComponentsView("menu"); }}
        >
          <Boxes size={16} /> Componenti
        </button>
      </div>

      {section === "reviews" && (
        <section className="card">
          <h2>
            <ClipboardList size={16} /> Revisioni configurazioni
          </h2>
          <p className="muted small mt-8">
            Modifiche proposte da chi ha accesso “con revisione” a una configurazione. Approvare salva
            la configurazione, non riavvia il server.
          </p>
          {requests.length === 0 && <p className="muted small mt-8">Nessuna revisione.</p>}
          {requests.map((r) => {
            const configSummary = summarizeConfigRequest(r, configs);
            const baseRevision = typeof r.payload.baseRevision === "number" ? r.payload.baseRevision : null;
            const currentRevision = configs.find((c) => c.id === r.payload.id)?.revision ?? null;
            const outdated = r.status === "pending" && baseRevision !== null && currentRevision !== null
              && baseRevision !== currentRevision;
            return (
            <article key={r.id} className="admin-request-item">
              <div className="row-center" style={{ justifyContent: "space-between" }}>
                <b className="small row-center" style={{ gap: "6px" }}>
                  {configSummary.isNew ? <Plus size={14} /> : <Pencil size={14} />}
                  {`${configSummary.isNew ? "Nuova configurazione" : "Modifica configurazione"}: "${configSummary.targetName}"`}
                </b>
                <span className={`pill pill-${r.status === "pending" ? "STARTING" : r.status === "approved" ? "RUNNING" : "STOPPED"}`}>
                  {r.status === "pending" ? "in attesa" : r.status === "approved" ? "approvata" : "rifiutata"}
                </span>
              </div>
              <ul className="muted small" style={{ margin: 0, paddingLeft: "18px" }}>
                {configSummary.lines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
              <span className="muted small">
                proposta da <b>{r.submittedBy.name}</b> · {new Date(r.submittedAt).toLocaleString("it-IT")}
              </span>
              {outdated && (
                <span className="muted small row-center" style={{ gap: "6px" }}>
                  <AlertCircle size={13} />
                  Proposta sulla revisione {baseRevision}, ora la configurazione è alla {currentRevision}: non è più
                  approvabile. Rifiutala e chiedi di riproporla.
                </span>
              )}
              {r.status === "pending" && (
                <div className="row-center" style={{ gap: "8px" }}>
                  <button className="btn" style={{ flex: 1 }} disabled={busy || outdated} onClick={() => approve(r.id)}>
                    <CheckCircle2 size={16} /> Approva
                  </button>
                  <button className="btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => reject(r.id)}>
                    <XCircle size={16} /> Rifiuta
                  </button>
                </div>
              )}
            </article>
            );
          })}
        </section>
      )}

      {section === "friends" && (
        <>
          <section className="card">
            <h2>
              <UserPlus size={16} /> Richieste di ingresso alla community
            </h2>
            {pendingJoinRequests.length === 0 && <p className="muted small mt-8">Nessuna richiesta di ingresso in attesa.</p>}
            {pendingJoinRequests.map((request) => (
              <article key={request.id} className="admin-request-item">
                <b className="small">{request.requester.name}</b>
                <span className="muted small">{request.requester.email} · {new Date(request.createdAt).toLocaleString("it-IT")}</span>
                {request.message && <span className="small">{request.message}</span>}
                <div className="row-center" style={{ gap: "8px" }}>
                  <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => void reviewJoinRequest(request, "approve")}>
                    <CheckCircle2 size={16} /> Accetta
                  </button>
                  <button className="btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => void reviewJoinRequest(request, "reject")}>
                    <XCircle size={16} /> Rifiuta
                  </button>
                </div>
              </article>
            ))}
          </section>

          <section className="card">
            <h2>
              <UserPlus size={16} /> Aggiungi membro
            </h2>
            <label>
              Email Google del membro
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="amico@example.com" autoComplete="email" />
            </label>

            <div className="mt-16">
              <span className="field-hint">Permessi iniziali</span>
              <div className="permission-group">
                <b>Controllo server</b>
                {PERMISSION_KEYS.map((key) => (
                  <label key={key} className="row-center" style={{ justifyContent: "space-between", marginTop: "10px", cursor: "pointer" }}>
                    <span className="field-hint" style={{ marginBottom: 0 }}>{PERMISSION_LABELS[key]}</span>
                    <span className="switch">
                      <input
                        type="checkbox"
                        checked={newPerms[key]}
                        disabled={busy}
                        onChange={(e) => setNewPerms((prev) => ({ ...prev, [key]: e.target.checked }))}
                      />
                      <span className="switch-track" />
                    </span>
                  </label>
                ))}
              </div>
              <p className="muted small mt-8">Mappa, mod e parametri si gestiscono dai collaboratori di ogni configurazione.</p>
            </div>

            <button className="btn w-full mt-16" disabled={busy || !newEmail.trim()} onClick={createFriend}>
              <UserPlus size={16} /> Autorizza email
            </button>
            <p className="muted small mt-12">L'accesso sarà disponibile subito al prossimo login, esclusivamente con questa email Google. Non viene inviata alcuna email.</p>
          </section>

          {friends.map((f) => (
            <section className="card member-card" key={f.id}>
              <h2>
                <Users size={16} /> {f.name}
                {f.disabled && <span className="pill pill-STOPPED">disabilitato</span>}
                {f.status === "pending" && <span className="pill pill-STARTING">invito in attesa</span>}
                {f.status === "rejected" && <span className="pill pill-STOPPED">non autorizzato</span>}
                {f.communityRole === "admin" && <span className="pill pill-RUNNING">admin</span>}
                {f.communityRole === "moderator" && <span className="pill pill-STARTING">moderatore</span>}
              </h2>
              <p className="muted small">
                {f.email} · autorizzato il {new Date(f.authorizedAt).toLocaleDateString("it-IT")}
                {f.lastUsedAt && ` · ultimo accesso ${new Date(f.lastUsedAt).toLocaleString("it-IT")}`}
              </p>
              <div className="member-game-identity mt-8">
                <Gamepad2 size={14} />
                {f.arkAccountId ? <code>{f.arkAccountId}</code> : <span>EOS/ARK ID non ancora collegato</span>}
              </div>

              {canManageRoles && f.authUserId && (
                <label>
                  Ruolo nella community
                  <select
                    value={f.communityRole ?? "member"}
                    disabled={busy}
                    onChange={(event) => void changeRole(f.id, event.target.value as "admin" | "moderator" | "member")}
                  >
                    <option value="member">Membro</option>
                    <option value="moderator">Moderatore</option>
                    <option value="admin">Amministratore</option>
                  </select>
                </label>
              )}

              {f.communityRole === "admin" ? (
                <p className="muted small mt-16">Gli amministratori hanno sempre tutti i permessi sul server.</p>
              ) : (
              <div className="mt-16">
                <div className="permission-group">
                  <b>Controllo server</b>
                  {PERMISSION_KEYS.map((key) => (
                    <label key={key} className="row-center" style={{ justifyContent: "space-between", marginTop: "10px", cursor: "pointer" }}>
                      <span className="field-hint" style={{ marginBottom: 0 }}>{PERMISSION_LABELS[key]}</span>
                      <span className="switch">
                        <input
                          type="checkbox"
                          checked={f.permissions[key]}
                          disabled={busy}
                          onChange={(e) => togglePermission(f.id, key, e.target.checked)}
                        />
                        <span className="switch-track" />
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              )}

              {f.status !== "pending" && (
                <div className="row-center mt-16" style={{ gap: "8px" }}>
                  <button className="btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => toggleDisabled(f.id, !f.disabled)}>
                    <Ban size={16} /> {f.disabled ? "Riattiva" : "Disabilita"}
                  </button>
                </div>
              )}
              <button className="btn-secondary w-full mt-8" disabled={busy} onClick={() => void remove(f)}>
                <Trash2 size={16} /> {f.status === "pending" ? "Revoca invito" : "Rimuovi dalla community"}
              </button>
            </section>
          ))}
        </>
      )}

      {section === "community" && (
        <section className="card">
          <h2>
            <Globe2 size={16} /> Profilo community
          </h2>
          <p className="muted small mt-8">Come la community appare nell'elenco delle community.</p>
          <label>Nome<input value={profileName} maxLength={80} onChange={(event) => setProfileName(event.target.value)} /></label>
          <label>Descrizione<textarea value={profileDescription} maxLength={600} onChange={(event) => setProfileDescription(event.target.value)} /></label>
          <label>Visibilità
            <select value={profileVisibility} onChange={(event) => setProfileVisibility(event.target.value as typeof profileVisibility)}>
              <option value="public">Pubblica — appare nella ricerca</option>
              <option value="unlisted">Non elencata — accessibile con link</option>
              <option value="private">Privata — solo inviti</option>
            </select>
          </label>
          <button className="btn w-full mt-16" disabled={busy || profileName.trim().length < 3} onClick={() => void saveCommunityProfile()}>
            <Save size={16} /> Salva profilo community
          </button>
        </section>
      )}

      {section === "gameAdmins" && (
        <>
          <section className="card access-control-card">
            <h2>
              <KeyRound size={16} /> Amministratori nel gioco
            </h2>
            <p className="muted small mt-8">
              Gli account autorizzati possono eseguire direttamente i comandi <code>cheat</code> e
              <code> admincheat</code> senza digitare <code>enablecheats</code> o la password RCON.
              La whitelist è globale e resta valida cambiando configurazione o mappa.
            </p>
            {adminWhitelist?.queued ? (
              <div className="banner banner-info mt-12" role="status">
                <Radio size={16} />
                <span>Modifica in coda: sarà scritta prima dell'avvio di ASA alla prossima accensione.</span>
              </div>
            ) : adminWhitelist?.diskMatches ? (
              <div className="banner banner-ok mt-12" role="status">
                <CheckCircle2 size={16} />
                <span>File whitelist allineato sul game server.</span>
              </div>
            ) : adminWhitelist?.initialized ? (
              <div className="banner banner-info mt-12" role="status">
                <Radio size={16} />
                <span>Whitelist salvata sul control plane; il game server è spento o non raggiungibile.</span>
              </div>
            ) : (
              <div className="banner banner-info mt-12" role="status">
                <Radio size={16} />
                <span>Nessuna whitelist è stata ancora configurata dalla PWA.</span>
              </div>
            )}
            <p className="muted small mt-12">
              A server online ASA rilegge automaticamente la lista locale entro 5 secondi. Dopo
              l'autorizzazione esci e rientra nel server perché i privilegi vengono assegnati alla connessione.
            </p>
          </section>

          {detectedPlayers.length > 0 && (
            <section className="card">
              <h2>
                <Radio size={16} /> Giocatori online rilevati
              </h2>
              <p className="muted small mt-8">
                L'ID arriva da RCON: seleziona il giocatore da autorizzare senza copiarlo a mano dal controller.
              </p>
              {detectedPlayers.map((player) => {
                const alreadyAllowed = adminWhitelist?.accountIds.includes(player.id) ?? false;
                return (
                  <div className="admin-account-row" key={player.id}>
                    <div>
                      <b className="small">{player.name}</b>
                      <code>{player.id}</code>
                    </div>
                    <button
                      className={alreadyAllowed ? "btn-secondary" : "btn"}
                      disabled={busy || alreadyAllowed}
                      onClick={() => void addAdminAccountId(player.id, player.name)}
                    >
                      {alreadyAllowed ? <CheckCircle2 size={15} /> : <Plus size={15} />}
                      {alreadyAllowed ? "Autorizzato" : "Autorizza"}
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {friends.some((friend) => friend.arkAccountId) && (
            <section className="card">
              <h2><Users size={16} /> Account community collegati</h2>
              <p className="muted small mt-8">
                Questi ID sono stati collegati direttamente dagli utenti nelle proprie impostazioni Google.
              </p>
              {friends.filter((friend) => friend.arkAccountId).map((friend) => {
                const accountId = friend.arkAccountId!;
                const alreadyAllowed = adminWhitelist?.accountIds.includes(accountId) ?? false;
                return (
                  <div className="admin-account-row" key={friend.id}>
                    <div>
                      <b className="small">{friend.name}</b>
                      <span className="muted small">{friend.email}</span>
                      <code>{accountId}</code>
                    </div>
                    <button
                      className={alreadyAllowed ? "btn-secondary" : "btn"}
                      disabled={busy || alreadyAllowed}
                      onClick={() => void addAdminAccountId(accountId, friend.name)}
                    >
                      {alreadyAllowed ? <CheckCircle2 size={15} /> : <Plus size={15} />}
                      {alreadyAllowed ? "Autorizzato" : "Autorizza"}
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          <section className="card">
            <h2>
              <Plus size={16} /> Aggiungi EOS/ARK ID
            </h2>
            <label>
              ID account di 32 caratteri
              <input
                className="admin-account-input"
                value={newAdminAccountId}
                maxLength={32}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="0123456789abcdef0123456789abcdef"
                onChange={(event) => setNewAdminAccountId(event.target.value.trim())}
              />
            </label>
            <button
              className="btn w-full mt-16"
              disabled={busy || !ADMIN_ACCOUNT_ID_PATTERN.test(newAdminAccountId)}
              onClick={() => void addAdminAccountId(newAdminAccountId)}
            >
              <Plus size={16} /> Autorizza account
            </button>
            <p className="muted small mt-12">
              Se il giocatore non è online, apri la console di ASA ed esegui <code>whoami</code>, quindi inserisci qui
              l'ID EOS/ARK alfanumerico di 32 caratteri mostrato dal gioco.
            </p>
          </section>

          <section className="card">
            <h2>
              <ShieldCheck size={16} /> Account autorizzati ({adminWhitelist?.accountIds.length ?? 0})
            </h2>
            {(adminWhitelist?.accountIds.length ?? 0) === 0 && (
              <p className="muted small mt-8">Nessun account può saltare l'autenticazione con password.</p>
            )}
            {adminWhitelist?.accountIds.map((id) => {
              const linkedAccount = friends.find((friend) => friend.arkAccountId === id);
              return (
              <div className="admin-account-row" key={id}>
                <div>
                  {linkedAccount && <b className="small">{linkedAccount.name} · {linkedAccount.email}</b>}
                  <code>{id}</code>
                </div>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  aria-label={`Rimuovi account ${id}`}
                  onClick={() => void removeAdminAccountId(id)}
                >
                  <Trash2 size={15} /> Rimuovi
                </button>
              </div>
              );
            })}
          </section>
        </>
      )}

      {section === "components" && (
        <section className="card">
          <h2>
            <Boxes size={16} /> Componenti installati
          </h2>
          <p className="muted small mt-8" style={{ marginBottom: "16px" }}>
            Mod scaricate sul game server e partite salvate su Object Storage: qui puoi vedere cosa
            c'è e, se non serve più, cancellarlo.
          </p>
          <button className="btn-secondary w-full row-center" style={{ justifyContent: "space-between" }} onClick={() => setComponentsView("mods")}>
            <span className="row-center" style={{ gap: "8px" }}><Puzzle size={16} /> Mod installate</span>
            <ChevronRight size={16} />
          </button>
          <button className="btn-secondary w-full row-center mt-8" style={{ justifyContent: "space-between" }} onClick={() => setComponentsView("saves")}>
            <span className="row-center" style={{ gap: "8px" }}><Save size={16} /> Partite salvate</span>
            <ChevronRight size={16} />
          </button>
        </section>
      )}
    </div>
  );
}
