import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Globe2,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { api } from "../api";
import { signOut } from "../auth";
import type { CommunityJoinRequest, CommunitySummary, ViewerMe } from "../types";
import { InstallButton } from "./InstallButton";
import { NotificationCenter } from "./NotificationCenter";

const ROLE_LABELS = {
  owner: "Titolare",
  admin: "Amministratore",
  moderator: "Moderatore",
  member: "Membro",
} as const;

function canReview(community: CommunitySummary): boolean {
  return community.membership?.status === "active"
    && ["owner", "admin", "moderator"].includes(community.membership.role);
}

/** Owner/admin di una community con pannello server gestiscono membri, richieste e
 * profilo da Opzioni → Amministrazione: qui resta solo per le community senza server
 * (dove quel pannello non esiste) e per i moderatori, che non vi hanno accesso. */
function managesFromPanel(community: CommunitySummary): boolean {
  const role = community.membership?.role;
  return community.membership?.status === "active"
    && (role === "owner" || role === "admin")
    && !!community.server?.available;
}

function CommunityCard({
  community,
  busy,
  onOpen,
  onJoin,
  onCancel,
  onReview,
}: {
  community: CommunitySummary;
  busy: boolean;
  onOpen: (community: CommunitySummary) => void;
  onJoin: (community: CommunitySummary) => void;
  onCancel: (community: CommunitySummary) => void;
  onReview: (community: CommunitySummary) => void;
}) {
  const membership = community.membership;
  const pending = community.joinRequest?.status === "pending";
  const administrativeMember = membership?.role === "owner" || membership?.role === "admin";
  const canUseServer = membership?.status === "active"
    && !!community.server?.available
    && (community.membersEnabled || administrativeMember);
  return (
    <article className="card community-card">
      <div className="community-card-head">
        <div className="community-emblem"><Users size={20} /></div>
        <div className="community-title-block">
          <h2>{community.name}</h2>
          <span className="muted small">/{community.slug} · {community.language.toUpperCase()}</span>
        </div>
        {membership && <span className="pill pill-RUNNING">{ROLE_LABELS[membership.role]}</span>}
      </div>
      <p className="muted small community-description">
        {community.description || "Questa community non ha ancora aggiunto una descrizione."}
      </p>
      <div className="community-meta">
        <span><Globe2 size={13} /> {community.visibility === "public" ? "Pubblica" : community.visibility === "unlisted" ? "Non elencata" : "Privata"}</span>
        <span>{community.region}</span>
        <span className={community.server?.available ? "community-server-ready" : "muted"}>
          {community.server?.available ? "Server disponibile" : "Server non ancora attivo"}
        </span>
      </div>

      {membership?.status === "suspended" && <div className="banner banner-error mt-12">Membership sospesa.</div>}
      {pending && (
        <div className="community-request-state mt-12">
          <Clock3 size={15} /> Richiesta di ingresso in revisione
        </div>
      )}

      <div className="community-actions mt-16">
        {canUseServer && (
          <button className="btn" disabled={busy} onClick={() => onOpen(community)}>
            Apri pannello <ChevronRight size={16} />
          </button>
        )}
        {membership?.status === "active" && community.server?.available && !community.membersEnabled && !administrativeMember && (
          <span className="muted small community-no-cost-note">Accesso membri temporaneamente disabilitato dagli amministratori.</span>
        )}
        {membership?.status === "active" && !community.server?.available && (
          <span className="muted small community-no-cost-note">
            Community pronta; il provisioning è disabilitato finché non saranno disponibili diritti e billing.
          </span>
        )}
        {!membership && !pending && community.joinPolicy === "request" && (
          <button className="btn-secondary" disabled={busy} onClick={() => onJoin(community)}>
            <UserPlus size={16} /> Richiedi di entrare
          </button>
        )}
        {!membership && pending && (
          <button className="btn-secondary" disabled={busy} onClick={() => onCancel(community)}>
            <XCircle size={16} /> Annulla richiesta
          </button>
        )}
        {canReview(community) && !managesFromPanel(community) && (
          <button className="btn-secondary" disabled={busy} onClick={() => onReview(community)}>
            <ShieldCheck size={16} /> Richieste e profilo
          </button>
        )}
        {managesFromPanel(community) && (
          <span className="muted small community-no-cost-note">
            Membri, richieste di ingresso e profilo: nel pannello, Opzioni → Amministrazione.
          </span>
        )}
      </div>
    </article>
  );
}

export function CommunityExplorer({
  initialSlug,
  onOpen,
}: {
  initialSlug?: string;
  onOpen: (community: CommunitySummary) => void;
}) {
  const [viewer, setViewer] = useState<ViewerMe | null>(null);
  const [items, setItems] = useState<CommunitySummary[]>([]);
  const [linkedCommunity, setLinkedCommunity] = useState<CommunitySummary | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [reviewCommunity, setReviewCommunity] = useState<CommunitySummary | null>(null);
  const [requests, setRequests] = useState<CommunityJoinRequest[]>([]);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<"public" | "unlisted" | "private">("public");
  const restoredSlug = useRef<string | null>(null);

  const load = useCallback(async (search = query) => {
    try {
      const [me, communities] = await Promise.all([api.viewer(), api.communities.list(search)]);
      setViewer(me);
      setItems(communities.items);
      setError(null);
      return communities.items;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, [query]);

  useEffect(() => { void load(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query, load]);

  useEffect(() => {
    if (!initialSlug) {
      restoredSlug.current = null;
      setLinkedCommunity(null);
      return;
    }
    if (restoredSlug.current === initialSlug) return;
    restoredSlug.current = initialSlug;
    let cancelled = false;
    let settled = false;
    void api.communities.get(initialSlug).then((community) => {
      if (cancelled) return;
      settled = true;
      const administrativeMember = community.membership?.role === "owner" || community.membership?.role === "admin";
      const canUseServer = community.membership?.status === "active"
        && !!community.server?.available
        && (community.membersEnabled || administrativeMember);
      if (canUseServer) onOpen(community);
      else setLinkedCommunity(community);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    // Sotto StrictMode l'effetto gira due volte: se la richiesta non è conclusa il
    // guard va liberato, altrimenti il secondo giro salta e il deep link resta muto.
    return () => {
      cancelled = true;
      if (!settled) restoredSlug.current = null;
    };
  }, [initialSlug, onOpen]);

  const visible = useMemo(
    () => {
      const combined = linkedCommunity && !items.some((community) => community.id === linkedCommunity.id)
        ? [linkedCommunity, ...items]
        : items;
      return filter === "mine" ? combined.filter((community) => !!community.membership) : combined;
    },
    [filter, items, linkedCommunity],
  );

  const notificationCommunity = viewer?.communities.find((community) => (
    community.membership?.status === "active" && community.server?.available
  ));

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function join(community: CommunitySummary) {
    const message = window.prompt(`Messaggio facoltativo per gli amministratori di ${community.name}:`, "") ?? null;
    if (message === null) return;
    void run(async () => {
      const updated = await api.communities.join(community.id, message);
      if (linkedCommunity?.id === updated.id) setLinkedCommunity(updated);
    });
  }

  async function openReview(community: CommunitySummary) {
    setBusy(true); setError(null);
    try {
      setRequests(await api.communities.requests(community.id));
      setReviewCommunity(community);
      setEditName(community.name);
      setEditDescription(community.description);
      setEditVisibility(community.visibility);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function review(request: CommunityJoinRequest, decision: "approve" | "reject") {
    if (!reviewCommunity) return;
    await manageCommunity(() => decision === "approve"
      ? api.communities.approve(reviewCommunity.id, request.id)
      : api.communities.reject(reviewCommunity.id, request.id));
  }

  async function manageCommunity(action: () => Promise<unknown>) {
    if (!reviewCommunity) return;
    setBusy(true); setError(null);
    try {
      await action();
      setRequests(await api.communities.requests(reviewCommunity.id));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function saveCommunityProfile() {
    if (!reviewCommunity || editName.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      const updated = await api.communities.update(reviewCommunity.id, {
        name: editName,
        description: editDescription,
        visibility: editVisibility,
      });
      setReviewCommunity(updated);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function submitCreate() {
    if (!name.trim()) return;
    await run(async () => {
      await api.communities.create({ name, description, visibility });
      setName(""); setDescription(""); setVisibility("public"); setShowCreate(false);
    });
  }

  return (
    <div className="app community-app">
      <a className="skip-link" href="#community-content">Vai alle community</a>
      <header className="topbar community-topbar">
        <span className="brand">
          <span className="brand-mark"><Users size={16} /></span>
          <span className="brand-text"><span className="brand-title">ARKSA</span><small>Community network</small></span>
        </span>
        <span className="topbar-spacer" />
        {notificationCommunity && <NotificationCenter communityId={notificationCommunity.id} />}
        <InstallButton />
        <button className="icon-btn" title="Esci" aria-label="Esci dall’account" onClick={() => signOut().then(() => window.location.assign("/"))}><LogOut size={17} /></button>
      </header>

      <main id="community-content" className="content community-content">
        <section className="community-hero" aria-labelledby="community-title">
          <div>
            <span className="eyebrow">Trova il tuo ARK</span>
            <h1 id="community-title">Community, amici e mondi condivisi.</h1>
            <p className="muted">Esplora i gruppi pubblici, richiedi l'accesso o prepara la tua community.</p>
          </div>
          {viewer && (
            <div className="viewer-chip">
              {viewer.profile.avatarUrl
                ? <img src={viewer.profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
                : <CircleUserRound size={24} />}
              <span><b>{viewer.profile.name}</b><small>{viewer.profile.email}</small></span>
            </div>
          )}
        </section>

        {error && <div className="banner banner-error" role="alert"><XCircle size={16} /> {error}</div>}

        <section className="community-toolbar" aria-label="Ricerca e filtri community">
          <label className="community-search">
            <span className="sr-only">Cerca una community</span>
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nome, descrizione o slug…" />
          </label>
          <div className="community-filters" aria-label="Filtra community">
            <button className={filter === "all" ? "btn" : "btn-secondary"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Tutte</button>
            <button className={filter === "mine" ? "btn" : "btn-secondary"} aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>Le mie</button>
            <button className="btn-secondary" aria-expanded={showCreate} aria-controls="community-create" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> Crea</button>
          </div>
        </section>

        {showCreate && (
          <section id="community-create" className="card community-create-card">
            <h2><Plus size={17} /> Nuova community</h2>
            <p className="muted small mt-8">La creazione non avvia server e non genera costi di infrastruttura.</p>
            <label>Nome<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="I Sopravvissuti" /></label>
            <label>Descrizione<textarea value={description} maxLength={600} onChange={(event) => setDescription(event.target.value)} placeholder="Presenta il gruppo e il suo stile di gioco…" /></label>
            <label>Visibilità
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}>
                <option value="public">Pubblica — appare nella ricerca</option>
                <option value="unlisted">Non elencata — accessibile con link</option>
                <option value="private">Privata — solo inviti</option>
              </select>
            </label>
            <button className="btn w-full" disabled={busy || name.trim().length < 3} onClick={() => void submitCreate()}>
              <Plus size={16} /> Crea senza server
            </button>
          </section>
        )}

        {reviewCommunity && (
          <section className="card community-review-card">
            <div className="community-card-head">
              <h2><ShieldCheck size={17} /> Gestisci · {reviewCommunity.name}</h2>
              <button className="icon-btn" aria-label="Chiudi gestione community" onClick={() => setReviewCommunity(null)}><XCircle size={17} /></button>
            </div>
            {reviewCommunity.membership && ["owner", "admin"].includes(reviewCommunity.membership.role) && <div className="community-profile-editor">
              <label>Nome<input value={editName} maxLength={80} onChange={(event) => setEditName(event.target.value)} /></label>
              <label>Descrizione<textarea value={editDescription} maxLength={600} onChange={(event) => setEditDescription(event.target.value)} /></label>
              <label>Visibilità
                <select value={editVisibility} onChange={(event) => setEditVisibility(event.target.value as typeof editVisibility)}>
                  <option value="public">Pubblica</option>
                  <option value="unlisted">Non elencata</option>
                  <option value="private">Privata</option>
                </select>
              </label>
              <button className="btn-secondary" disabled={busy || editName.trim().length < 3} onClick={() => void saveCommunityProfile()}>
                Salva profilo community
              </button>
            </div>}
            <h2 className="community-team-title"><UserPlus size={17} /> Richieste di ingresso</h2>
            {requests.filter((request) => request.status === "pending").length === 0 && <p className="muted small mt-8">Nessuna richiesta in attesa.</p>}
            {requests.filter((request) => request.status === "pending").map((request) => (
              <div className="community-review-row" key={request.id}>
                <div><b>{request.requester.name}</b><small>{request.requester.email}</small>{request.message && <p>{request.message}</p>}</div>
                <div>
                  <button className="icon-btn community-approve" disabled={busy} onClick={() => void review(request, "approve")} title="Approva"><CheckCircle2 size={18} /></button>
                  <button className="icon-btn" disabled={busy} onClick={() => void review(request, "reject")} title="Rifiuta"><XCircle size={18} /></button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="community-list" aria-live="polite">
          {visible.map((community) => (
            <CommunityCard
              key={community.id}
              community={community}
              busy={busy}
              onOpen={onOpen}
              onJoin={join}
              onCancel={(item) => void run(async () => {
                await api.communities.cancelJoin(item.id);
                if (linkedCommunity?.id === item.id) setLinkedCommunity({ ...item, joinRequest: null });
              })}
              onReview={(item) => void openReview(item)}
            />
          ))}
          {visible.length === 0 && (
            <div className="card empty-state"><span className="empty-icon"><Users size={26} /></span><b>Nessuna community trovata</b><span className="muted small">Prova una ricerca diversa o crea il tuo gruppo.</span></div>
          )}
        </section>
      </main>
    </div>
  );
}
