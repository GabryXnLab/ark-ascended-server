import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, TouchEvent } from "react";
import { api, setActiveCommunityId } from "./api";
import type { CommunitySummary, Me, Status } from "./types";
import { Dashboard } from "./components/Dashboard";
import { GameConfig } from "./components/GameConfig";
import { Settings } from "./components/Settings";
import { resolvePlatform } from "./platform";
import { UsageCosts } from "./components/UsageCosts";
import { InstallButton } from "./components/InstallButton";
import { CommunityExplorer } from "./components/CommunityExplorer";
import { NotificationCenter } from "./components/NotificationCenter";
import {
  Gauge,
  Layers,
  Coins,
  Settings as SettingsIcon,
  Mountain,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";

// Quattro schede fisse nella bottom bar: accensione/configurazione di avvio/coda
// vivono ora nella tab "Stato"; mappa+mod+parametri giocatore sono unite nella tab
// "Configurazioni" (pacchetti salvabili/caricabili) e l'Amministrazione vive come
// sezione interna di "Opzioni" (solo per admin).
type Tab = "dashboard" | "config" | "usage" | "settings";

const TABS: { id: Tab; label: string; icon: React.ComponentType<any> }[] = [
  { id: "dashboard", label: "Stato", icon: Gauge },
  { id: "config", label: "Config", icon: Layers },
  { id: "usage", label: "Costi", icon: Coins },
  { id: "settings", label: "Opzioni", icon: SettingsIcon },
];

const POLL_MS = 5000;
const SWIPE_MIN_DX = 56;
const METRICS_HISTORY_MAX = 60; // finestra scorrevole ~5 minuti di campioni (un campione per poll)

export interface MetricsSample {
  ts: number;
  cpuPct: number;
  memUsedGb: number;
  playerCount: number;
}

function haptic(ms = 8) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(ms); } catch { /* dispositivo senza supporto: ignora */ }
  }
}

function routeCommunitySlug(): string | undefined {
  const match = window.location.pathname.match(/^\/c\/([a-z0-9-]+)\/?/);
  return match?.[1];
}

export function App() {
  const [routeSlug, setRouteSlug] = useState<string | undefined>(() => routeCommunitySlug());
  const [community, setCommunity] = useState<CommunitySummary | null>(null);
  const communityCache = useRef(new Map<string, CommunitySummary>());

  const openCommunity = useCallback((next: CommunitySummary) => {
    communityCache.current.set(next.slug, next);
    setActiveCommunityId(next.id);
    setRouteSlug(next.slug);
    setCommunity(next);
    if (window.location.pathname !== `/c/${next.slug}`) window.history.pushState({}, "", `/c/${next.slug}`);
  }, []);

  const closeCommunity = useCallback(() => {
    setActiveCommunityId(null);
    setRouteSlug(undefined);
    setCommunity(null);
    if (window.location.pathname !== "/") window.history.pushState({}, "", "/");
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const nextSlug = routeCommunitySlug();
      setRouteSlug(nextSlug);
      if (!nextSlug) {
        setActiveCommunityId(null);
        setCommunity(null);
        return;
      }
      const cached = communityCache.current.get(nextSlug);
      setActiveCommunityId(cached?.id ?? null);
      setCommunity(cached ?? null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (!community) return <CommunityExplorer initialSlug={routeSlug} onOpen={openCommunity} />;
  return <ServerPanel key={community.id} community={community} onBack={closeCommunity} />;
}

function ServerPanel({ community, onBack }: { community: CommunitySummary; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dir, setDir] = useState<"fwd" | "back" | "none">("none");
  const [status, setStatus] = useState<Status | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<MetricsSample[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swipeLocked, setSwipeLocked] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const costsEnabled = resolvePlatform(status).features.costs;
  const tabs = costsEnabled ? TABS : TABS.map((t) => (t.id === "usage" ? { ...t, label: "Tempo di gioco" } : t));

  const refresh = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      setError(null);
      // Il backend non storicizza le metriche (GET /status ritorna solo l'istante
      // corrente): lo storico per gli sparkline della dashboard è quindi accumulato
      // solo qui, lato client, in un buffer a finestra scorrevole session-scoped
      // (si azzera al reload — compromesso accettato, niente persistenza backend).
      if (s.metrics) {
        const sample: MetricsSample = {
          ts: Date.now(),
          cpuPct: s.metrics.cpuPct,
          memUsedGb: s.metrics.memUsedGb,
          playerCount: s.ark?.playerCount ?? 0,
        };
        setMetricsHistory((prev) => [...prev, sample].slice(-METRICS_HISTORY_MAX));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshMe = useCallback(async () => {
    try { setMe(await api.serverMe()); } catch { /* stato/dashboard restano comunque utilizzabili */ }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshMe();
    const id = setInterval(() => {
      void refresh();
      void refreshMe();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, refreshMe]);

  const index = tabs.findIndex((t) => t.id === tab);

  const goTo = useCallback(
    (next: Tab) => {
      setTab((current) => {
        if (current === next) return current;
        const from = tabs.findIndex((t) => t.id === current);
        const to = tabs.findIndex((t) => t.id === next);
        setDir(to > from ? "fwd" : "back");
        return next;
      });
      haptic();
    },
    [tabs],
  );

  function onTouchStart(e: TouchEvent) {
    if (swipeLocked) return;
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || swipeLocked) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    const current = tabs.findIndex((t2) => t2.id === tab);
    const nextTab = dx < 0 ? tabs[current + 1] : dx > 0 ? tabs[current - 1] : undefined;
    if (nextTab) goTo(nextTab.id);
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">Vai al contenuto</a>
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} title="Torna alle community" aria-label="Torna alle community"><ArrowLeft size={18} /></button>
        <span className="brand">
          <span className="brand-mark">
            <Mountain size={16} />
          </span>
          <span className="brand-text">
            <span className="brand-title">{community.name}</span>
            <small>/{community.slug}</small>
          </span>
        </span>
        <span className="topbar-spacer" />
        <NotificationCenter communityId={community.id} />
        <InstallButton />
        {status && <span className={`pill pill-${status.instance.state}`} aria-label={`Stato istanza: ${status.instance.state}`}>{status.instance.state}</span>}
      </header>

      {error && (
        <div className="banner banner-error" role="alert" style={{ margin: "14px 16px 0" }}>
          <AlertTriangle size={16} /> <span>{error}</span>
        </div>
      )}

      <main id="main-content" className="content" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div key={tab} className={`page-transition dir-${dir}`} id={`tab-content-${tab}`} tabIndex={-1}>
          {tab === "dashboard" && (
            <Dashboard status={status} metricsHistory={metricsHistory} me={me} onChange={refresh} />
          )}
          {tab === "config" && (
            <GameConfig
              status={status}
              me={me}
              onChange={refresh}
              onEditingChange={setSwipeLocked}
              onGoToStatus={() => goTo("dashboard")}
            />
          )}
          {tab === "usage" && <UsageCosts me={me} showCosts={costsEnabled} />}
          {tab === "settings" && (
            <Settings status={status} me={me} community={community} onProfileChange={refreshMe} />
          )}
        </div>
      </main>

      <nav
        className="tabbar"
        aria-label="Navigazione principale"
        style={{ "--tab-count": tabs.length, "--tab-index": index } as CSSProperties}
      >
        <span className="tab-indicator" aria-hidden="true" />
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={tab === t.id ? "tab active" : "tab"}
              onClick={() => goTo(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
            >
              <span className="tab-icon">
                <Icon size={19} />
              </span>
              <span className="tab-label">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
