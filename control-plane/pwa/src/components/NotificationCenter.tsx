import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, CheckCheck, Circle, Power, Radio, Settings2, ShieldAlert, X } from "lucide-react";
import { api } from "../api";
import type { CommunityNotification, CommunityNotificationList } from "../types";
import "../notification-center.css";

const POLL_MS = 8_000;

type DevicePermission = NotificationPermission | "unsupported";

function currentDevicePermission(): DevicePermission {
  return typeof window !== "undefined" && "Notification" in window
    ? window.Notification.permission
    : "unsupported";
}

function formattedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

async function showDeviceNotification(item: CommunityNotification): Promise<void> {
  if (!("Notification" in window) || window.Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body: item.message,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: `arksa-${item.id}`,
    data: { communityId: item.communityId, notificationId: item.id },
  };
  try {
    const registration = "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration()
      : undefined;
    if (registration) {
      await registration.showNotification(item.title, options);
    } else {
      new window.Notification(item.title, options);
    }
  } catch {
    // Il feed in-app resta autorevole anche se il sistema operativo rifiuta
    // una notifica locale (per esempio per limiti della modalità browser).
  }
}

export function NotificationCenter({ communityId }: { communityId: string }) {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<CommunityNotificationList>({ items: [], unreadCount: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<DevicePermission>(currentDevicePermission);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const seenIdsRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const next = await api.notifications.list(communityId, { limit: 40 });
      if (initializedRef.current) {
        for (const item of [...next.items].reverse()) {
          if (!seenIdsRef.current.has(item.id)) void showDeviceNotification(item);
        }
      } else {
        initializedRef.current = true;
      }
      for (const item of next.items) seenIdsRef.current.add(item.id);
      setFeed(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    initializedRef.current = false;
    seenIdsRef.current.clear();
    setLoading(true);
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function markRead(item: CommunityNotification): Promise<void> {
    if (item.readAt) return;
    try {
      const result = await api.notifications.markRead(communityId, item.id);
      setFeed((current) => ({
        unreadCount: Math.max(0, current.unreadCount - 1),
        items: current.items.map((candidate) => candidate.id === item.id
          ? { ...candidate, readAt: result.readAt }
          : candidate),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function markAllRead(): Promise<void> {
    if (feed.unreadCount === 0) return;
    try {
      const result = await api.notifications.markAllRead(communityId);
      setFeed((current) => ({
        unreadCount: 0,
        items: current.items.map((item) => item.readAt ? item : { ...item, readAt: result.readAt }),
      }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await load();
    }
  }

  async function requestDevicePermission(): Promise<void> {
    if (!("Notification" in window)) return;
    setPermissionBusy(true);
    try {
      setPermission(await window.Notification.requestPermission());
    } finally {
      setPermissionBusy(false);
    }
  }

  return (
    <div className="notification-center" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn notification-trigger ${feed.unreadCount > 0 ? "has-unread" : ""}`}
        aria-label={feed.unreadCount > 0 ? `Notifiche: ${feed.unreadCount} non lette` : "Notifiche"}
        aria-expanded={open}
        aria-controls="community-notification-panel"
        onClick={() => {
          setOpen((current) => !current);
          if (!open) void load();
        }}
      >
        {feed.unreadCount > 0 ? <BellRing size={18} /> : <Bell size={18} />}
        {feed.unreadCount > 0 && (
          <span className="notification-count" aria-hidden="true">
            {feed.unreadCount > 99 ? "99+" : feed.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          id="community-notification-panel"
          className="notification-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="notification-panel-title"
        >
          <header className="notification-panel-header">
            <div>
              <span className="eyebrow">Community</span>
              <h2 id="notification-panel-title">Notifiche</h2>
            </div>
            <div className="notification-panel-actions">
              {feed.unreadCount > 0 && (
                <button type="button" className="icon-btn" onClick={() => void markAllRead()} aria-label="Segna tutte come lette" title="Segna tutte come lette">
                  <CheckCheck size={17} />
                </button>
              )}
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Chiudi notifiche">
                <X size={17} />
              </button>
            </div>
          </header>

          {permission === "default" && (
            <button
              type="button"
              className="notification-device-prompt"
              disabled={permissionBusy}
              onClick={() => void requestDevicePermission()}
            >
              <Settings2 size={16} />
              <span><strong>Attiva gli avvisi sul dispositivo</strong><small>Ricevili mentre la PWA è in esecuzione.</small></span>
            </button>
          )}
          {permission === "denied" && (
            <p className="notification-permission-note">Gli avvisi di sistema sono bloccati nelle impostazioni del browser; quelli in-app restano disponibili qui.</p>
          )}

          {error && <p className="notification-error" role="alert">{error}</p>}

          <div className="notification-list">
            {loading && feed.items.length === 0 ? (
              <p className="notification-empty">Aggiorno le notifiche…</p>
            ) : feed.items.length === 0 ? (
              <div className="notification-empty">
                <Bell size={22} />
                <strong>Nessuna notifica</strong>
                <span>Accensioni, conferme online e spegnimenti di sicurezza compariranno qui per tutti i membri.</span>
              </div>
            ) : feed.items.map((item) => {
              const Icon = item.kind === "server_online" ? Radio : item.kind === "server_watchdog_stopped" ? ShieldAlert : Power;
              return (
                <button
                  type="button"
                  className={`notification-item ${item.readAt ? "is-read" : "is-unread"}`}
                  onClick={() => void markRead(item)}
                  key={item.id}
                >
                  <span className={`notification-kind notification-kind-${item.kind}`} aria-hidden="true"><Icon size={16} /></span>
                  <span className="notification-copy">
                    <span className="notification-item-title">
                      <strong>{item.title}</strong>
                      {!item.readAt && <Circle size={7} fill="currentColor" aria-label="Non letta" />}
                    </span>
                    <span>{item.message}</span>
                    <time dateTime={item.createdAt}>{formattedDate(item.createdAt)}</time>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
