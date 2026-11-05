import { useEffect, useMemo, useState } from "react";
import { Copy, Save, X, AlertCircle, CheckCircle, Info, Puzzle, FileText, ShieldCheck, UserCheck, LockKeyhole } from "lucide-react";
import { api } from "../api";
import type { ConfigAccessMode, ConfigMember, GameConfiguration, ModCategory } from "../types";
import { ALL_GAME_SETTING_FIELDS } from "../gameSettingsSchema";
import { GameSettingsEditor } from "./GameSettingsEditor";
import { ModsCatalog } from "./ModsCatalog";
import { InstalledMods } from "./InstalledMods";
import { ModDetailModal } from "./ModDetailModal";
import { MapPicker } from "./MapPicker";
import type { MapPreset } from "../mapCatalog";
import { missingRequiredConfigFields, REQUIRED_CONFIG_FIELD_LABELS } from "../configValidation";
import { parseRawDirectives, splitLaunchArgs, validateConfigSettings } from "../configRules";

// ModID realmente presenti sul disco del game server, per il badge "già scaricata".
// /mods/installed include anche le mod solo referenziate dalle configurazioni (senza
// dimensione): quelle non sono scaricate e non devono avere il badge. A VM spenta il
// disco non è leggibile e il set resta vuoto.
function useInstalledModIds(): Set<number> {
  const [ids, setIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    api.modLibrary.list()
      .then(({ mods }) => setIds(new Set(mods.filter((m) => m.sizeBytes !== null).map((m) => m.id))))
      .catch(() => setIds(new Set()));
  }, []);
  return ids;
}

// "".split(",") produce [""], e Number("") vale 0 (non NaN): senza lo scarto
// esplicito delle stringhe vuote un campo mod vuoto verrebbe letto come ModID 0.
function parseModIds(text: string): number[] {
  return text.split(",").map((s) => s.trim()).filter((s) => s !== "").map(Number).filter(Number.isFinite);
}

function iniValuesFromConfig(cfg: GameConfiguration | null): Record<string, string> {
  if (!cfg) return {};
  return { ...cfg.iniOverrides.gus.values, ...cfg.iniOverrides.game.values };
}

/** Costruisce gli overrides ini (gus/game, valori+sezioni) dallo stato piatto dell'editor. */
function buildIniOverrides(
  values: Record<string, string>,
  raw: { gus: string; game: string; launch: string },
): GameConfiguration["iniOverrides"] {
  const gusValues: Record<string, string> = {};
  const gusSections: Record<string, string> = {};
  const gameValues: Record<string, string> = {};
  const gameSections: Record<string, string> = {};
  for (const field of ALL_GAME_SETTING_FIELDS) {
    // I segreti infrastrutturali non devono entrare nel payload del profilo:
    // sono condivisi con RCON e ruotati separatamente dal runtime.
    if (field.infrastructureManaged) continue;
    // Gli spazi ai bordi delle stringhe non sono mai voluti (e finirebbero nell'URL di avvio).
    const typed = values[field.key];
    const v = (field.type === "string" ? typed?.trim() : typed) ?? (field.key === "ServerPassword" ? "" : undefined);
    // Una password giocatore vuota è un valore effettivo (server pubblico),
    // non un campo da omettere: deve poter sovrascrivere una password salvata
    // in precedenza. Per gli altri campi, vuoto continua a significare default.
    if (v === undefined || (v === "" && field.key !== "ServerPassword")) continue;
    if (field.file === "GameUserSettings") {
      gusValues[field.key] = v;
      if (field.section) gusSections[field.key] = field.section;
    } else {
      gameValues[field.key] = v;
      if (field.section) gameSections[field.key] = field.section;
    }
  }
  return {
    gus: {
      values: gusValues,
      sections: gusSections,
      raw: raw.gus,
      managedKeys: ALL_GAME_SETTING_FIELDS.filter((field) => field.file === "GameUserSettings").map((field) => field.key),
    },
    game: {
      values: gameValues,
      sections: gameSections,
      raw: raw.game,
      managedKeys: ALL_GAME_SETTING_FIELDS.filter((field) => field.file === "Game").map((field) => field.key),
    },
    launchArgs: raw.launch,
  };
}

// Bozza non salvata dell'editor, persistita in localStorage così un'interruzione
// (chiusura scheda, crash, navigazione accidentale) non fa perdere il lavoro in corso
// anche se la configurazione non è ancora completa/salvabile sul server.
interface EditorDraft {
  name: string;
  map: string;
  modsText: string;
  values: Record<string, string>;
  raw: { gus: string; game: string; launch: string };
  savedAt: string;
}

function draftKeyFor(editing: GameConfiguration | null): string {
  return `arksa.configDraft.${editing?.id ?? "new"}`;
}

/** Ignora bozze più vecchie dell'ultimo salvataggio noto (es. applicato da un altro dispositivo/utente nel frattempo). */
function loadDraft(editing: GameConfiguration | null): EditorDraft | null {
  try {
    const raw = localStorage.getItem(draftKeyFor(editing));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditorDraft;
    const latestSavedAt = editing?.accessUpdatedAt && editing.accessUpdatedAt > editing.updatedAt
      ? editing.accessUpdatedAt
      : editing?.updatedAt;
    if (latestSavedAt && parsed.savedAt <= latestSavedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function ConfigEditor({ configs, editing, isAdmin, currentUserId, onSaved, onCancel }: {
  configs: GameConfiguration[];
  editing: GameConfiguration | null;
  isAdmin: boolean;
  currentUserId: string;
  onSaved: (configId: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const editAccess = editing?.capabilities.access ?? "full";
  // Senza diritti di modifica l'editor diventa una vista di consultazione: il
  // backend restituisce comunque l'intero profilo a ogni membro.
  const readOnly = editAccess === "none";
  const draftKey = useMemo(() => draftKeyFor(editing), [editing]);
  // Calcolata una sola volta al mount (lazy initializer): rappresenta lo stato dell'editor
  // al momento in cui è stato aperto, prima di qualunque modifica dell'utente in questa sessione.
  const [draft] = useState(() => readOnly ? null : loadDraft(editing));
  const [draftRestored] = useState(() => draft !== null);

  const [name, setName] = useState(draft?.name ?? editing?.name ?? "");
  const [map, setMap] = useState(draft?.map ?? editing?.map ?? "");
  const [modsText, setModsText] = useState(draft?.modsText ?? editing?.mods.join(", ") ?? "");
  const [values, setValues] = useState<Record<string, string>>(draft?.values ?? (() => iniValuesFromConfig(editing)));
  const [raw, setRaw] = useState(() => ({
    gus: draft?.raw?.gus ?? editing?.iniOverrides.gus.raw ?? "",
    game: draft?.raw?.game ?? editing?.iniOverrides.game.raw ?? "",
    launch: draft?.raw?.launch ?? editing?.iniOverrides.launchArgs ?? "",
  }));
  const [copyModsFrom, setCopyModsFrom] = useState("");
  const [copyMapFrom, setCopyMapFrom] = useState("");
  const installedModIds = useInstalledModIds();
  const [categories, setCategories] = useState<ModCategory[]>([]);
  const [members, setMembers] = useState<ConfigMember[]>([]);
  const [accessControl, setAccessControl] = useState<GameConfiguration["accessControl"]>(
    editing?.accessControl ?? { administratorLocked: false, grants: {} },
  );
  const [inspectingId, setInspectingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api.modCategories().then(setCategories).catch(() => setCategories([])),
      api.configs.members().then(setMembers).catch(() => setMembers([])),
    ]);
  }, []);

  // Autosave della bozza (debounced): se l'editing viene interrotto senza un salvataggio
  // esplicito (chiusura scheda, crash, navigazione), al riapertura viene recuperata da loadDraft().
  useEffect(() => {
    if (readOnly) return;
    const timeout = setTimeout(() => {
      const draftToSave: EditorDraft = { name, map, modsText, values, raw, savedAt: new Date().toISOString() };
      try {
        localStorage.setItem(draftKey, JSON.stringify(draftToSave));
      } catch {
        // Storage pieno o non disponibile (es. modalità privata): la bozza resta solo in memoria.
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [readOnly, draftKey, name, map, modsText, values, raw]);

  function clearDraft() {
    try { localStorage.removeItem(draftKey); } catch { /* niente da pulire */ }
  }

  // Istantanea del profilo salvato: serve a capire se "Annulla" butterebbe via lavoro.
  const [pristine] = useState(() => JSON.stringify({
    name: editing?.name ?? "",
    map: editing?.map ?? "",
    modsText: editing?.mods.join(", ") ?? "",
    values: iniValuesFromConfig(editing),
    raw: {
      gus: editing?.iniOverrides.gus.raw ?? "",
      game: editing?.iniOverrides.game.raw ?? "",
      launch: editing?.iniOverrides.launchArgs ?? "",
    },
  }));

  function cancel() {
    const dirty = !readOnly && JSON.stringify({ name, map, modsText, values, raw }) !== pristine;
    if (dirty && !window.confirm("Uscire senza salvare? Le modifiche non salvate a questa configurazione andranno perse.")) return;
    clearDraft();
    onCancel();
  }

  const activeModIds = useMemo(() => new Set(parseModIds(modsText)), [modsText]);
  const otherConfigs = useMemo(() => configs.filter((c) => c.id !== editing?.id), [configs, editing]);
  const advancedCount = useMemo(
    () => parseRawDirectives("GameUserSettings", raw.gus).directives.length
      + parseRawDirectives("Game", raw.game).directives.length
      + splitLaunchArgs(raw.launch).length,
    [raw],
  );
  const missingFields = useMemo(() => missingRequiredConfigFields({ name, map }), [name, map]);
  const canManageAccess = editing?.capabilities.canManageAccess ?? true;
  const selectableMembers = useMemo(
    () => members.filter((member) => member.id !== currentUserId),
    [members, currentUserId],
  );

  function setMemberAccess(userId: string, mode: "none" | ConfigAccessMode) {
    setAccessControl((current) => {
      const grants = { ...current.grants };
      if (mode === "none") delete grants[userId];
      else grants[userId] = mode;
      return { ...current, grants };
    });
  }

  function addMod(id: number) {
    if (activeModIds.has(id)) return;
    setModsText((t) => (t.trim() ? `${t.trim()}, ${id}` : String(id)));
  }
  function removeMod(id: number) {
    setModsText((t) => t.split(",").map((s) => s.trim()).filter((s) => s !== "" && Number(s) !== id).join(", "));
  }

  function applyCopyMods(id: string) {
    setCopyModsFrom(id);
    const src = configs.find((c) => c.id === id);
    if (src) setModsText(src.mods.join(", "));
  }
  function applyCopyMap(id: string) {
    setCopyMapFrom(id);
    const src = configs.find((c) => c.id === id);
    if (src) setMap(src.map);
  }

  // Selezionare una mod-mappa precarica anche il suo ModID: senza,
  // l'utente sceglierebbe la mappa ma dimenticherebbe di aggiungere la mod richiesta.
  function selectPreset(preset: MapPreset) {
    setMap(preset.map);
    if (preset.mods && preset.mods.length > 0) {
      const missing = preset.mods.filter((id) => !activeModIds.has(id));
      if (missing.length > 0) {
        setModsText((t) => (t.trim() ? `${t.trim()}, ${missing.join(", ")}` : missing.join(", ")));
      }
    }
  }

  // Nome e mappa non sono più richiesti per salvare: una configurazione a metà va comunque
  // persistita per non perdere il lavoro (vedi missingFields per il blocco solo sul deploy).
  async function save() {
    setErr(null); setMsg(null);
    const iniOverrides = buildIniOverrides(values, raw);
    // Stessa validazione del backend e dell'agent: l'errore appare prima dell'invio.
    const invalid = validateConfigSettings(iniOverrides, ALL_GAME_SETTING_FIELDS);
    if (invalid.length > 0) {
      const shown = invalid.slice(0, 5).join("; ");
      setErr(`Configurazione non valida: ${shown}${invalid.length > 5 ? `; altri ${invalid.length - 5} errori` : ""}`);
      return;
    }
    setBusy(true);
    try {
      // L'ACL non cambia la revisione runtime: salvarla prima evita che un
      // errore di rete sul secondo passo lasci l'editor con una baseRevision
      // ormai superata dopo che il contenuto è già stato scritto.
      if (editing && canManageAccess) {
        await api.configs.setAccess(editing.id, accessControl);
      }
      const { pending, configuration } = await api.configs.save({
        ...(editing ? { id: editing.id } : {}),
        ...(editing ? { baseRevision: editing.revision } : { accessControl }),
        name: name.trim(),
        map: map.trim(),
        mods: parseModIds(modsText),
        iniOverrides,
      });
      if (pending) {
        setMsg("Richiesta inviata: in attesa di approvazione dell'amministratore.");
      } else {
        clearDraft();
        await onSaved(configuration?.id ?? editing?.id ?? null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      {err && (
        <div className="banner banner-error">
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{err}</span>
        </div>
      )}
      {msg && (
        <div className="banner banner-ok">
          <CheckCircle size={18} style={{ flexShrink: 0 }} />
          <span>{msg}</span>
        </div>
      )}
      {draftRestored && (
        <div className="banner banner-info">
          <Info size={18} style={{ flexShrink: 0 }} />
          <span>Ripristinata una bozza non salvata dell'ultima modifica interrotta.</span>
        </div>
      )}

      {readOnly && (
        <div className="banner banner-info">
          <LockKeyhole size={18} style={{ flexShrink: 0 }} />
          <span>Sola lettura: puoi consultare questa configurazione ma il proprietario o un amministratore non ti ha concesso di modificarla.</span>
        </div>
      )}

      <fieldset className="config-editor-fieldset" disabled={readOnly}>
      <section className="card">
        <h2>
          <Puzzle size={16} /> Identità configurazione
        </h2>
        <label>Nome configurazione<input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Astraeos PvE facile" /></label>
        <p className="muted small mt-8">Il nome visibile nel browser ARK (SessionName) è nella categoria Generale dei parametri di gioco.</p>
      </section>

      {canManageAccess && (
        <section className="card config-access-card">
          <h2><ShieldCheck size={16} /> Permessi della configurazione</h2>
          <p className="muted small mt-8">
            Scegli chi può lavorare su questa configurazione. “Con revisione” invia la modifica
            alle revisioni degli amministratori; “Completo” salva direttamente. Titolare e
            amministratori della community possono sempre modificarla. I permessi si salvano
            insieme alla configurazione.
          </p>
          {isAdmin && (
            <label className="config-lock-row">
              <span>
                <b>Blocca anche il proprietario</b>
                <small>
                  Se attivo, il proprietario perde i diritti impliciti: può modificarla solo se è
                  nella lista qui sotto e non può più cambiarla né eliminarla.
                </small>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={accessControl.administratorLocked}
                  onChange={(event) => setAccessControl((current) => ({
                    ...current,
                    administratorLocked: event.target.checked,
                  }))}
                />
                <span className="switch-track" />
              </span>
            </label>
          )}
          {accessControl.administratorLocked && (
            <div className="banner banner-info mt-12">
              <LockKeyhole size={16} />
              <span>Permessi bloccati da un amministratore: valgono anche per il proprietario.</span>
            </div>
          )}
          <div className="config-member-list mt-16">
            {selectableMembers.length === 0 && (
              <p className="muted small">Non ci sono altri account attivi nella community.</p>
            )}
            {selectableMembers.map((member) => {
              const administrator = member.role === "owner" || member.role === "admin";
              return (
                <div className="config-member-row" key={member.id}>
                  <div className="config-member-identity">
                    <UserCheck size={16} />
                    <span>
                      <b>{member.name}</b>
                      <small>{member.email}</small>
                      <code>{member.arkAccountId ?? "EOS/ARK ID non collegato"}</code>
                    </span>
                  </div>
                  {administrator ? (
                    <span className="pill pill-RUNNING">override admin</span>
                  ) : (
                    <select
                      aria-label={`Accesso di ${member.name}`}
                      value={accessControl.grants[member.id] ?? "none"}
                      onChange={(event) => setMemberAccess(member.id, event.target.value as "none" | ConfigAccessMode)}
                    >
                      <option value="none">Nessuno</option>
                      <option value="review">Con revisione</option>
                      <option value="full">Completo</option>
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <MapPicker
        map={map}
        onSelectPreset={selectPreset}
        onCustomMap={setMap}
        otherConfigs={otherConfigs}
        copyMapFrom={copyMapFrom}
        onCopyMap={applyCopyMap}
      />

      <section className="card">
        <div className="section-header">
          <span className="field-hint" style={{ margin: 0 }}>ModID (separati da virgola)</span>
          {otherConfigs.length > 0 && (
            <label className="copy-from-inline" title="Copia i mod da un'altra configurazione">
              <Copy size={13} />
              <select value={copyModsFrom} onChange={(e) => applyCopyMods(e.target.value)}>
                <option value="">Copia da…</option>
                {otherConfigs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="field-box">
          <label>
            <input value={modsText} onChange={(e) => setModsText(e.target.value)} placeholder="es. 929110, 941689" />
          </label>
        </div>
      </section>

      <InstalledMods ids={[...activeModIds]} onRemove={removeMod} onInspect={setInspectingId} sharedModIds={installedModIds} />
      <ModsCatalog
        activeModIds={activeModIds}
        onAdd={addMod}
        onInspect={setInspectingId}
        categories={categories}
        sharedModIds={installedModIds}
      />

      <GameSettingsEditor
        values={values}
        onChange={setValues}
        description="Parametri giocatore salvati in questa configurazione. Un campo vuoto significa &quot;valore di default del gioco&quot;."
        otherConfigs={otherConfigs}
        getConfigIniValues={iniValuesFromConfig}
        advancedCount={advancedCount}
      />

      <section className="card">
        <h2><FileText size={16} /> Direttive INI avanzate</h2>
        <p className="muted small mt-8">
          Per configurazioni strutturate o ripetute: spawn e sostituzioni creature,
          curve XP/livelli, punti engramma, costi crafting, loot crate, clamp oggetti e
          opzioni di mod. Una direttiva per riga; le righe senza header usano la sezione
          predefinita del file. Queste righe fanno parte del profilo e vengono sostituite,
          non accumulate, a ogni avvio.
        </p>
        <label style={{ marginTop: "16px" }}>
          <span className="field-hint">Game.ini avanzato</span>
          <span className="field-desc">Sezione predefinita: [/script/shootergame.shootergamemode]. Sono ammesse chiavi ripetute.</span>
          <textarea
            className="ini-raw-editor"
            value={raw.game}
            onChange={(e) => setRaw((state) => ({ ...state, game: e.target.value }))}
            placeholder={'LevelExperienceRampOverrides=(ExperiencePointsForLevel[0]=1,...)\nOverridePlayerLevelEngramPoints=8\nOverridePlayerLevelEngramPoints=10'}
            spellCheck={false}
          />
        </label>
        <label style={{ marginTop: "16px" }}>
          <span className="field-hint">GameUserSettings.ini avanzato / sezioni mod</span>
          <span className="field-desc">Le righe iniziano in [ServerSettings]; aggiungi [NomeSezione] per una sezione diversa.</span>
          <textarea
            className="ini-raw-editor"
            value={raw.gus}
            onChange={(e) => setRaw((state) => ({ ...state, gus: e.target.value }))}
            placeholder={'[NomeMod]\nOpzione=True'}
            spellCheck={false}
          />
        </label>
        <label style={{ marginTop: "16px" }}>
          <span className="field-hint">Argomenti di avvio ASA avanzati</span>
          <span className="field-desc">Un argomento ufficiale per riga, sempre con “-”. I parametri già presenti nel form o gestiti dall'infrastruttura vengono rifiutati per evitare override ambigui.</span>
          <textarea
            className="ini-raw-editor"
            value={raw.launch}
            onChange={(e) => setRaw((state) => ({ ...state, launch: e.target.value }))}
            placeholder={'-culture=it\n-DisableCustomCosmetics\n-AlwaysTickDedicatedSkeletalMeshes'}
            spellCheck={false}
          />
        </label>
      </section>
      </fieldset>

      {editAccess === "review" && (
        <div className="banner banner-info">
          <Info size={17} />
          <span>Le tue modifiche saranno applicate solo dopo l'approvazione di un amministratore.</span>
        </div>
      )}
      {!readOnly && missingFields.length > 0 && (
        <div className="banner banner-info">
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>
            Campi obbligatori mancanti: {missingFields.map((f) => REQUIRED_CONFIG_FIELD_LABELS[f]).join(", ")}.
            Puoi salvare comunque come bozza, ma finché non li compili la configurazione non potrà essere
            applicata/deployata sul server Ark.
          </span>
        </div>
      )}
      <div className="row-center" style={{ gap: "10px" }}>
        <button className="btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={cancel}>
          <X size={16} /> {readOnly ? "Chiudi" : "Annulla"}
        </button>
        {!readOnly && (
          <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={save}>
            <Save size={16} /> {editAccess === "review" ? "Invia in revisione" : "Salva configurazione"}
          </button>
        )}
      </div>

      {inspectingId !== null && (
        <ModDetailModal
          modId={inspectingId}
          added={activeModIds.has(inspectingId)}
          categories={categories}
          onClose={() => setInspectingId(null)}
          onAdd={readOnly ? undefined : addMod}
        />
      )}
    </div>
  );
}
