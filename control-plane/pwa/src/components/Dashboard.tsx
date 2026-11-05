import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Server, Gamepad2, Gauge, Users, Copy, Check, Globe, Cpu, HardDrive, MemoryStick,
  Power, ListChecks, Info, AlertTriangle, CheckCircle, Lock, Play, Compass, Clock, RefreshCw,
} from "lucide-react";
import { api } from "../api";
import type { BootQueueOp, GameConfiguration, Me, Status } from "../types";
import type { MetricsSample } from "../App";
import { fmtUptime } from "./util";
import { Sparkline } from "./Sparkline";
import { missingConfigFieldLabels } from "../configValidation";
import { useProvisionStatus } from "./ProvisionProgress";
import { platformCopy, gameEndpoint, resolvePlatform } from "../platform";
import { OperationProgress } from "./OperationProgress";
import { IdleStopControl } from "./IdleStopControl";

/** Messaggio del banner "aggiornamenti in coda": plurale italiano corretto sul
 * conteggio, non solo "N elemento/i". */
function bootQueueMessage(count: number, isOn: boolean): string {
  const plural = count > 1;
  if (isOn) {
    return `Sincronizzazione in corso: applico ${count} modifica${plural ? "he" : ""} accumulat${plural ? "e" : "a"} mentre il server era spento…`;
  }
  return `${count} modifica${plural ? "he" : ""} in coda: verr${plural ? "anno" : "à"} applicat${plural ? "e" : "a"} automaticamente alla prossima accensione.`;
}

const PLATFORM_LABELS: Record<string, string> = {
  PC: "PC", XSX: "Xbox", PS5: "PlayStation", WINGDK: "PC (Microsoft Store)",
};

/** Piattaforme ammesse dal profilo in esecuzione: vuoto = default del launcher (ALL). */
function platformLabel(value: string | undefined): string {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized || normalized === "ALL") return "Crossplay: PC e console";
  const parts = normalized.split("+").map((part) => PLATFORM_LABELS[part] ?? part);
  return parts.length === 1 ? `Solo ${parts[0]}` : `Crossplay: ${parts.join(", ")}`;
}

export function Dashboard({ status, metricsHistory, me, onChange }: {
  status: Status | null;
  metricsHistory: MetricsSample[];
  me: Me | null;
  onChange: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  const [powerBusy, setPowerBusy] = useState(false);
  const [powerErr, setPowerErr] = useState<string | null>(null);
  const [confirmShutdown, setConfirmShutdown] = useState(false);

  const [configs, setConfigs] = useState<GameConfiguration[]>([]);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [configErr, setConfigErr] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [bootQueue, setBootQueue] = useState<BootQueueOp[]>([]);
  const [confirmConfigId, setConfirmConfigId] = useState<string | null>(null);

  const state = status?.instance.state ?? "UNKNOWN";
  const isOn = state === "RUNNING";
  const shuttingDown = status?.shutdown.inProgress ?? false;
  const transitioning = state === "STARTING" || state === "STOPPING" || shuttingDown;
  const capacityPending = status?.powerStart.pending ?? false;
  const canPower = me?.role !== "friend" || me.permissions.power;
  const canTimer = me?.role !== "friend" || me.permissions.timer;
  const canApplyConfig = me?.role !== "friend" || me.permissions.applyConfig;

  const provision = useProvisionStatus(isOn, api.provisionStatus);
  const provisionBusy = !!provision
    && provision.stage !== "idle" && provision.stage !== "online" && provision.stage !== "error";

  const loadConfigs = useCallback(async () => {
    try {
      const [list, queued] = await Promise.all([api.configs.list(), api.configs.queued()]);
      setConfigs(list);
      setQueuedId(queued.id);
      setSelectedId((prev) => list.some((item) => item.id === prev) ? prev : queued.id || list[0]?.id || "");
      setConfigErr(null);
    } catch (e) { setConfigErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  // Poll (non solo al mount): mentre il server è acceso, boot-sync svuota la coda in
  // background (vedi backend/src/boot-sync.ts) e "predefinita attuale" può cambiare da
  // sola — l'utente deve vederlo senza dover ricaricare la pagina.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      void loadConfigs();
      api.bootQueue.list().then((ops) => { if (!cancelled) setBootQueue(ops); }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [loadConfigs]);

  // Quando il profilo in esecuzione diventa "stale" lo si preseleziona: il pulsante
  // unico sotto diventa allora "Riavvia il gioco con le modifiche".
  const staleActiveId = status?.configuration.stale ? status.configuration.activeId : null;
  useEffect(() => {
    if (staleActiveId) setSelectedId(staleActiveId);
  }, [staleActiveId]);

  async function togglePower() {
    setConfirmShutdown(false);
    setPowerBusy(true); setPowerErr(null);
    try {
      await (isOn ? api.powerOff() : api.powerOn());
      await onChange();
    } catch (e) {
      setPowerErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPowerBusy(false);
    }
  }

  async function cancelPowerStart() {
    setPowerBusy(true); setPowerErr(null);
    try {
      await api.powerOff();
      await onChange();
    } catch (e) {
      setPowerErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPowerBusy(false);
    }
  }

  const selectedConfig = useMemo(() => configs.find((c) => c.id === selectedId) ?? null, [configs, selectedId]);
  const activeConfig = useMemo(
    () => configs.find((c) => c.id === status?.configuration.activeId) ?? null,
    [configs, status?.configuration.activeId],
  );
  const selectedMissing = useMemo(
    () => (selectedConfig ? missingConfigFieldLabels(selectedConfig) : ""),
    [selectedConfig],
  );

  async function selectConfig(configId = selectedId) {
    if (!configId) return;
    setConfirmConfigId(null);
    setConfigBusy(true); setConfigErr(null); setConfigMsg(null);
    try {
      const result = await api.configs.select(configId);
      setConfigMsg(
        result.applied
          ? "Riavvio del gioco avviato: segui percentuale e passaggi nel pannello Alimentazione."
          : result.instanceState === "RUNNING"
            ? "Il game server non è ancora pronto: la configurazione verrà applicata appena risponde."
            : "Server spento: la configurazione verrà caricata automaticamente al prossimo avvio.",
      );
      await loadConfigs(); await onChange();
    } catch (e) { setConfigErr(e instanceof Error ? e.message : String(e)); }
    finally { setConfigBusy(false); }
  }

  /** A gioco online il cambio disconnette tutti: chiede conferma come lo spegnimento. */
  function requestSelectConfig() {
    if (status?.ark?.online) setConfirmConfigId(selectedId);
    else void selectConfig();
  }

  if (!status) return <DashboardSkeleton />;
  const { instance, ark, metrics } = status;
  const platform = resolvePlatform(status);
  const copy = platformCopy(platform.provider);
  const running = instance.state === "RUNNING";
  const powerStateLabel = capacityPending
    ? "Accensione in attesa"
    : powerBusy
      ? "Invio richiesta"
      : state === "STARTING"
        ? "Accensione in corso"
        : state === "STOPPING" || shuttingDown
          ? "Spegnimento in corso"
          : isOn
            ? "Server acceso"
            : "Server spento";
  const powerActionLabel = capacityPending
    ? "Accensione in coda"
    : powerBusy
      ? "Invio richiesta…"
      : state === "STARTING"
        ? "Accensione in corso…"
        : state === "STOPPING" || shuttingDown
          ? "Spegnimento in corso…"
          : isOn
            ? "Spegni il server"
            : "Accendi il server";

  const cpuHistory = metricsHistory.map((s) => s.cpuPct);
  const memHistory = metricsHistory.map((s) => s.memUsedGb);
  const playersHistory = metricsHistory.map((s) => s.playerCount);

  const handleCopy = () => {
    const endpoint = gameEndpoint(status);
    if (endpoint) {
      navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="grid dashboard-grid">
      <div className="dashboard-col">
      {/* ---------------------------------------------------------------- *
       * Alimentazione — comando primario con conferma di arresto
       * ---------------------------------------------------------------- */}
      <section className={`card power-card power-card-${state.toLowerCase()}`}>
        <div className="power-card-header">
          <div>
            <span className="eyebrow">Controllo server</span>
            <h2>
              <Power size={16} /> Alimentazione
            </h2>
          </div>
          <span className={`power-status power-status-${state.toLowerCase()}`} aria-live="polite">
            <span className="pulse-dot" aria-hidden="true" />
            {powerStateLabel}
          </span>
        </div>

        {powerErr && (
          <div className="banner banner-error mt-8" role="alert">
            <AlertTriangle size={16} />
            <span>{powerErr}</span>
          </div>
        )}

        {status.shutdown.lastError && !shuttingDown && isOn && (
          <div className="banner banner-error mt-8" role="alert">
            <AlertTriangle size={16} />
            <span>Spegnimento non completato: {status.shutdown.lastError}. Riprova.</span>
          </div>
        )}

        {capacityPending && (
          <div className="banner banner-info mt-8" role="status">
            <RefreshCw size={16} style={{ animation: "spin 1.4s linear infinite" }} />
            <span>
              Capacità OCI temporaneamente esaurita. Tentativo {status.powerStart.attempt}; prossimo retry
              {status.powerStart.nextAttemptAt
                ? ` alle ${new Date(status.powerStart.nextAttemptAt).toLocaleTimeString("it-IT")}`
                : " a breve"}.
            </span>
          </div>
        )}

        <div className="power-action-wrap">
          <button
            type="button"
            className={`power-action ${isOn ? "power-action-stop" : "power-action-start"}`}
            disabled={powerBusy || transitioning || capacityPending || !canPower}
            onClick={() => isOn ? setConfirmShutdown(true) : void togglePower()}
            aria-describedby="power-action-help"
          >
            <span className="power-action-icon" aria-hidden="true">
              {powerBusy || transitioning ? <RefreshCw className="power-spinner" size={28} /> : <Power size={28} />}
            </span>
            <span>
              <strong>{powerActionLabel}</strong>
              <small>{isOn ? "Arresta in modo ordinato la sessione ARK" : "Avvia istanza, aggiornamenti e mondo ARK"}</small>
            </span>
          </button>
          <p id="power-action-help" className="power-cost-note">
            {isOn
              ? ark?.online ? `${ark.playerCount} giocator${ark.playerCount === 1 ? "e" : "i"} online` : "Il server ARK si sta preparando"
              : "Da spento resta attivo soltanto lo spazio di archiviazione"}
          </p>
        </div>

        <OperationProgress status={status} provision={provision} />

        {confirmShutdown && (
          <div className="power-confirm" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>Confermi lo spegnimento?</strong>
              <p>
                {copy.shutdownConfirm}
                {ark?.online && ark.playerCount > 0
                  ? ` ${ark.playerCount} giocator${ark.playerCount === 1 ? "e" : "i"} online ${ark.playerCount === 1 ? "sarà disconnesso" : "saranno disconnessi"}.`
                  : ""}
              </p>
              <div className="power-confirm-actions">
                <button type="button" className="btn-secondary" onClick={() => setConfirmShutdown(false)}>
                  Annulla
                </button>
                <button type="button" className="btn-danger" disabled={powerBusy} onClick={() => void togglePower()}>
                  <Power size={16} /> Conferma spegnimento
                </button>
              </div>
            </div>
          </div>
        )}

        {capacityPending && canPower && (
          <button className="btn btn-secondary w-full mt-12" disabled={powerBusy} onClick={cancelPowerStart}>
            Annulla richiesta di accensione
          </button>
        )}

        {!canPower && (
          <div className="banner banner-error mt-12">
            <Lock size={16} />
            <span>Accensione/spegnimento disabilitato dall'amministratore.</span>
          </div>
        )}

        <IdleStopControl status={status} canTimer={canTimer} onChange={onChange} />
      </section>

      {/* ---------------------------------------------------------------- *
       * Configurazione di avvio — quale profilo applicare/mettere in coda
       * ---------------------------------------------------------------- */}
      <section className="card startup-config">
        <h2>
          <ListChecks size={16} />
          <span>Configurazione di avvio</span>
        </h2>

        <p className="muted small row-center">
          <Info size={14} />
          <span>
            {isOn
              ? "Scegli quale configurazione applicare subito al server acceso."
              : "Scegli quale configurazione verrà caricata automaticamente al prossimo avvio."}
          </span>
        </p>

        {bootQueue.length > 0 && (
          <div className="banner banner-info mt-8">
            {isOn ? <RefreshCw size={16} style={{ animation: "spin 1.4s linear infinite" }} /> : <Clock size={16} />}
            <span>{bootQueueMessage(bootQueue.length, isOn)}</span>
          </div>
        )}

        {status.configuration.stale && activeConfig && (
          <div className="banner banner-error mt-8" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <AlertTriangle size={16} />
            <span style={{ flex: "1 1 190px" }}>
              La configurazione in esecuzione “{activeConfig.name}” è stata modificata. Il server sta ancora
              usando la revisione precedente: riavvia il gioco qui sotto per applicarla.
            </span>
          </div>
        )}

        {!canApplyConfig && (
          <div className="banner banner-error mt-8">
            <Lock size={16} />
            <span>Caricamento configurazione disabilitato dall'amministratore.</span>
          </div>
        )}

        {isOn && !status.ark && !shuttingDown && (
          <div className="banner banner-info mt-8" role="status">
            <RefreshCw size={16} style={{ animation: "spin 1.4s linear infinite" }} />
            <span>Server in avvio: una configurazione scelta ora verrà applicata appena il game server risponde.</span>
          </div>
        )}

        {configErr && (
          <div className="banner banner-error mt-8">
            <AlertTriangle size={16} />
            <span>{configErr}</span>
          </div>
        )}
        {configMsg && (
          <div className="banner banner-ok mt-8">
            <CheckCircle size={16} />
            <span>{configMsg}</span>
          </div>
        )}

        {configs.length === 0 ? (
          <p className="muted small row-center mt-12">
            <Compass size={14} />
            <span>Nessuna configurazione salvata: creane una nella tab "Config".</span>
          </p>
        ) : (
          <>
            <label className="sr-only" htmlFor="startup-configuration">Configurazione da avviare</label>
            <select
              id="startup-configuration"
              className="w-full mt-12"
              value={selectedId}
              disabled={!canApplyConfig || configBusy || provisionBusy}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || "(senza nome)"}{queuedId === c.id ? " (predefinita)" : ""}
                  {missingConfigFieldLabels(c) ? " (incompleta)" : ""}
                </option>
              ))}
            </select>
            <p className="muted small mt-8 selected-config-name">
              {configs.find((c) => c.id === selectedId)?.name || "(senza nome)"}
            </p>

            {selectedMissing && (
              <div className="banner banner-error mt-8">
                <AlertTriangle size={16} />
                <span>
                  Configurazione incompleta: mancano {selectedMissing}. Completala nella tab "Config" prima di
                  poterla applicare o impostare come avvio predefinito.
                </span>
              </div>
            )}

            {queuedId && (
              <p className="muted small mt-8 row-center">
                <Clock size={13} />
                <span>
                  Configurazione selezionata: {configs.find((c) => c.id === queuedId)?.name ?? "—"}
                  {" "}
                  <span className={`pill pill-${isOn ? "RUNNING" : "STARTING"}`}>
                    {isOn
                      ? queuedId === status.configuration.activeId ? "in esecuzione" : "in applicazione"
                      : "al prossimo avvio"}
                  </span>
                </span>
              </p>
            )}

            {(() => {
              const agentReady = isOn && !!status.ark;
              const selectedIsActive = selectedId === status.configuration.activeId;
              const label = !isOn
                ? "Imposta come avvio predefinito"
                : !agentReady
                  ? "Applica appena il server è pronto"
                  : selectedIsActive
                    ? status.configuration.stale ? "Riavvia il gioco con le modifiche" : "Riavvia il gioco con questa configurazione"
                    : "Cambia configurazione e riavvia";
              const disabled = !canApplyConfig || configBusy || provisionBusy || shuttingDown || !selectedId || !!selectedMissing
                || (isOn
                  ? agentReady && selectedIsActive && !status.configuration.stale
                  : selectedId === queuedId);
              return (
                <button className="btn w-full mt-12" disabled={disabled} onClick={requestSelectConfig}>
                  <Play size={16} />
                  <span>{label}</span>
                </button>
              );
            })()}

            {confirmConfigId && (
              <div className="power-confirm mt-12" role="alert">
                <AlertTriangle size={18} />
                <div>
                  <strong>Riavviare il gioco adesso?</strong>
                  <p>
                    ARK viene fermato e riavviato con “{configs.find((c) => c.id === confirmConfigId)?.name || "(senza nome)"}”:
                    il server resta irraggiungibile per qualche minuto.
                    {ark?.online && ark.playerCount > 0
                      ? ` ${ark.playerCount} giocator${ark.playerCount === 1 ? "e" : "i"} online ${ark.playerCount === 1 ? "sarà disconnesso" : "saranno disconnessi"}.`
                      : " Nessun giocatore è online in questo momento."}
                  </p>
                  <div className="power-confirm-actions">
                    <button type="button" className="btn-secondary" onClick={() => setConfirmConfigId(null)}>
                      Annulla
                    </button>
                    <button type="button" className="btn-danger" disabled={configBusy} onClick={() => void selectConfig(confirmConfigId)}>
                      <RefreshCw size={16} /> Conferma riavvio
                    </button>
                  </div>
                </div>
              </div>
            )}

          </>
        )}
      </section>

      {/* ---------------------------------------------------------------- *
       * Connessione — invariata
       * ---------------------------------------------------------------- */}
      {running && instance.publicIp && (
        <section className="card connection-card">
          <h2>
            <Globe size={16} /> Connessione server
          </h2>
          <p className="muted small mt-8">
            Indirizzo da condividere per la connessione diretta. In ARK cerca il server tra gli
            <i> Unofficial</i> oppure usa "Connetti tramite IP" dove disponibile.
          </p>
          <div className="endpoint-container">
            <span className="endpoint">{gameEndpoint(status)}</span>
            <button className="btn-copy" onClick={handleCopy} title="Copia indirizzo" aria-label={copied ? "Indirizzo copiato" : "Copia indirizzo server"}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <div className="kv mt-12">
            <span>Porta di gioco</span>
            <b>7777</b>
          </div>
          {activeConfig && (
            <div className="kv">
              <span>Piattaforme</span>
              <b style={{ fontFamily: "var(--font-sans)" }}>
                {platformLabel(activeConfig.iniOverrides.gus.values.ServerPlatform)}
              </b>
            </div>
          )}
        </section>
      )}
      </div>

      <div className="dashboard-col">
      {/* ---------------------------------------------------------------- *
       * Panoramica — colpo d'occhio su istanza + ARK, poi dettagli
       * ---------------------------------------------------------------- */}
      <section className="card">
        <h2>
          <Server size={16} /> Panoramica
        </h2>
        <div className="kpi-grid">
          <KpiTile
            label="Istanza"
            icon={<Server size={15} />}
            value={
              <span className={`state state-${instance.state}`}>
                <span className="pulse-dot"></span>
                {instance.state}
              </span>
            }
          />
          <KpiTile
            label="Server ARK"
            icon={<Gamepad2 size={15} />}
            value={
              !running || !ark ? (
                <span className="state state-STOPPED">{running ? "avvio…" : "spento"}</span>
              ) : ark.online ? (
                <span className="state state-RUNNING">
                  <span className="pulse-dot"></span>
                  online
                </span>
              ) : (
                <span className="state state-STARTING">
                  <span className="pulse-dot"></span>
                  avvio
                </span>
              )
            }
          />
        </div>

        <div className="kv">
          <span>{copy.endpointLabel}</span>
          <b>{gameEndpoint(status) ?? "—"}</b>
        </div>
        {running && ark && (
          <>
            <div className="kv">
              <span>Mappa</span>
              <b>{ark.map ?? "—"}</b>
            </div>
            {ark.version && (
              <div className="kv">
                <span>Versione</span>
                <b>v{ark.version}</b>
              </div>
            )}
          </>
        )}
        {running && metrics && (
          <div className="kv">
            <span>Uptime</span>
            <b>{fmtUptime(metrics.uptimeSec)}</b>
          </div>
        )}
        {me?.role === "admin" && (
          <div className="kv">
            <span>ID risorsa</span>
            <b className="small" style={{ wordBreak: "break-all", fontSize: "11px", opacity: 0.75 }}>
              {instance.ocid}
            </b>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- *
       * Risorse — CPU/RAM/disco con andamento recente
       * ---------------------------------------------------------------- */}
      {running && metrics && (
        <section className="card">
          <h2>
            <Gauge size={16} /> Risorse
          </h2>
          <Meter
            icon={<Cpu size={13} />}
            label="CPU"
            value={metrics.cpuPct}
            max={100}
            unit="%"
            history={cpuHistory}
          />
          <Meter
            icon={<MemoryStick size={13} />}
            label="RAM"
            value={metrics.memUsedGb}
            max={metrics.memTotalGb}
            unit="GB"
            history={memHistory}
          />
          {metrics.diskUsedGb != null && metrics.diskTotalGb != null && (
            <Meter
              icon={<HardDrive size={13} />}
              label="Disco"
              value={metrics.diskUsedGb}
              max={metrics.diskTotalGb}
              unit="GB"
            />
          )}
          {cpuHistory.length < 2 && (
            <p className="muted small mt-8">L'andamento nel tempo compare dopo qualche campionamento (~5s l'uno).</p>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- *
       * Giocatori — presenza attuale e trend della sessione
       * ---------------------------------------------------------------- */}
      {running && ark && (
        <section className="card">
          <h2>
            <Users size={16} /> Giocatori
          </h2>
          <div className="players-kpi">
            <div>
              <span className="players-kpi-value">
                {ark.playerCount}
                {ark.maxPlayers ? <span className="players-kpi-max"> / {ark.maxPlayers}</span> : null}
              </span>
              <span className="players-kpi-label">online ora</span>
            </div>
            {playersHistory.length >= 2 && (
              <div className="players-kpi-spark">
                <Sparkline
                  values={playersHistory}
                  color="var(--rune)"
                  height={34}
                  formatValue={(v) => `${Math.round(v)} online`}
                  ariaLabel="Andamento giocatori online"
                />
              </div>
            )}
          </div>
          {ark.players.length > 0 ? (
            <ul className="players">
              {ark.players.map((p) => (
                <li key={p.id || p.name}>
                  <span className="player-avatar">{p.name.slice(0, 2)}</span>
                  {p.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small mt-8">Nessun giocatore online in questo momento.</p>
          )}
        </section>
      )}

      </div>
    </div>
  );
}

function KpiTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="kpi-tile">
      <span className="kpi-tile-icon">{icon}</span>
      <span className="kpi-tile-value">{value}</span>
      <span className="kpi-tile-label">{label}</span>
    </div>
  );
}

function Meter({
  icon,
  label,
  value,
  max,
  unit,
  history,
}: {
  icon?: ReactNode;
  label: string;
  value: number;
  max: number;
  unit: string;
  history?: number[];
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  // Stessa soglia usata per barra e sparkline: il valore normale resta
  // monocromatico, ambra e rosso segnalano attenzione e criticità.
  let colorClass = "";
  let toneColor = "var(--rune)";
  if (pct > 85) {
    colorClass = "danger";
    toneColor = "var(--blood)";
  } else if (pct > 70) {
    colorClass = "warn";
    toneColor = "var(--glyph)";
  }

  const formatVal = (v: number) => {
    return Number.isInteger(v) ? v.toString() : v.toFixed(1);
  };

  return (
    <div className="meter">
      <div className="meter-head">
        <span>
          {icon} {label}
        </span>
        <b>
          {formatVal(value)}
          {unit === "%" ? "%" : ` ${unit}`}
          {unit !== "%" ? ` / ${formatVal(max)}` : ""}
        </b>
      </div>
      {history && history.length >= 2 && (
        <div className="meter-spark">
          <Sparkline
            values={history}
            color={toneColor}
            height={30}
            formatValue={(v) => `${formatVal(v)}${unit === "%" ? "%" : ` ${unit}`}`}
            ariaLabel={`Andamento ${label}`}
          />
        </div>
      )}
      <div className="bar">
        <div className={`bar-fill ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid dashboard-grid">
      <section className="card">
        <div className="skeleton skeleton-line w-40" />
        <div className="kpi-grid mt-12">
          <div className="skeleton" style={{ height: 62, borderRadius: "var(--r-sm)" }} />
          <div className="skeleton" style={{ height: 62, borderRadius: "var(--r-sm)" }} />
        </div>
        <div className="skeleton skeleton-line" style={{ marginTop: 16 }} />
        <div className="skeleton skeleton-line w-60" />
      </section>
      {[0, 1].map((i) => (
        <section className="card" key={i}>
          <div className="skeleton skeleton-line w-40" />
          <div className="skeleton skeleton-line" style={{ marginTop: 16 }} />
          <div className="skeleton skeleton-line w-60" />
          <div className="skeleton skeleton-line w-40" />
        </section>
      ))}
    </div>
  );
}
