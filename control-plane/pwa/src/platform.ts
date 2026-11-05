import type { PlatformInfo, PlatformProvider } from "./types";

export interface PlatformCopy {
  compute: string;
  shutdownConfirm: string;
  shutdownBackup: string;
  shutdownWatchdog: string;
  stopping: string;
  queued: string;
  startingDetail: string;
  connectedDetail: string;
  variableNote: string;
  idleSafety: string;
  endpointLabel: string;
}

const OCI_COPY: PlatformCopy = {
  compute: "VM",
  shutdownConfirm: "Il mondo viene salvato e copiato nel backup su Object Storage, poi la VM si spegne.",
  shutdownBackup: "Salvo il mondo e, se ARK era andato online, lo copio su Object Storage; poi OCI spegne la VM.",
  shutdownWatchdog: "ARK non è diventato online in tempo: spengo la VM per non pagarla a vuoto, senza toccare il backup.",
  stopping: "Il salvataggio è stato richiesto; OCI sta spegnendo la VM senza eliminare il disco persistente.",
  queued: "OCI ritenterà automaticamente appena trova capacità",
  startingDetail: "OCI sta accendendo la VM x86 e preparando rete, disco e container.",
  connectedDetail: "La VM è accesa; attendo che il container risponda e prenda in carico la configurazione.",
  variableNote: "Stima per fasi verificabili: questa attività può durare di più se sono presenti aggiornamenti o capacità OCI limitata.",
  idleSafety: "con la VM accesa il server viene spento per sicurezza.",
  endpointLabel: "Indirizzo",
};

const DOCKER_COPY: PlatformCopy = {
  compute: "container",
  shutdownConfirm: "Il mondo viene salvato e copiato nella cartella di backup, poi il container si ferma.",
  shutdownBackup: "Salvo il mondo e, se ARK era andato online, lo copio nella cartella di backup; poi fermo il container.",
  shutdownWatchdog: "ARK non è diventato online in tempo: fermo il container senza toccare il backup.",
  stopping: "Il salvataggio è stato richiesto; Docker sta fermando il container senza eliminare i dati persistenti.",
  queued: "Il pannello ritenterà automaticamente l'avvio",
  startingDetail: "Docker sta avviando il container del gioco e preparando i volumi.",
  connectedDetail: "Il container è acceso; attendo che risponda e prenda in carico la configurazione.",
  variableNote: "Stima per fasi verificabili: questa attività può durare di più se sono presenti aggiornamenti di gioco o mod.",
  idleSafety: "con il container acceso il server viene spento per sicurezza.",
  endpointLabel: "Indirizzo",
};

export function platformCopy(provider: PlatformProvider | undefined): PlatformCopy {
  return provider === "docker" ? DOCKER_COPY : OCI_COPY;
}

// Un backend più vecchio non invia `platform`: equivale a OCI, il comportamento storico.
export function resolvePlatform(status: { platform?: PlatformInfo } | null | undefined): PlatformInfo {
  return status?.platform ?? {
    provider: "oci",
    gamePort: 7777,
    features: { costs: true, capacityRetry: true, storageLabel: "object-storage" },
  };
}

export function gameEndpoint(status: { instance: { publicIp: string | null }; platform?: PlatformInfo }): string | null {
  const ip = status.instance.publicIp;
  return ip ? `${ip}:${resolvePlatform(status).gamePort}` : null;
}
