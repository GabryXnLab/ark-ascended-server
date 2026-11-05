import { agent, trySoft } from "./agent.js";
import { config } from "./config.js";
import { LEGACY_COMMUNITY_ID, LEGACY_SERVER_ID } from "./community-model.js";
import { log } from "./logger.js";
import { notifications } from "./notifications-store.js";
import { getController } from "./oci/index.js";

export interface NotificationObserver {
  observeServerOnline(communityId: string, serverId: string, online: boolean): Promise<void>;
}

export class ServerOnlineMonitor {
  constructor(
    private readonly controller = getController,
    private readonly arkStatus = () => trySoft(() => agent.arkStatus()),
    private readonly observer: NotificationObserver = notifications,
  ) {}

  async pollOnce(): Promise<void> {
    const ctrl = await this.controller();
    const { state } = await ctrl.getInfo();
    if (state !== "RUNNING") {
      await this.observer.observeServerOnline(LEGACY_COMMUNITY_ID, LEGACY_SERVER_ID, false);
      return;
    }
    const ark = await this.arkStatus();
    // Un timeout transitorio dell'agent non equivale a un arresto: non riarmare
    // l'evento finché non osserviamo esplicitamente offline o la VM non è RUNNING.
    if (ark === null) return;
    await this.observer.observeServerOnline(LEGACY_COMMUNITY_ID, LEGACY_SERVER_ID, ark.online);
  }
}

const monitor = new ServerOnlineMonitor();
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    await monitor.pollOnce();
  } catch (error) {
    log.warn("Monitor notifiche server fallito, ritento al prossimo intervallo", error);
  }
}

export function startNotificationSync(): void {
  const intervalMs = Math.max(5, config.queuedConfigSyncIntervalSec) * 1000;
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
}

export function stopNotificationSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
