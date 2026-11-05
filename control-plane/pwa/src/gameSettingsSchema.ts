// Catalogo delle impostazioni server di ARK: Survival Ascended verificato con
// la ARK Official Community Wiki e con configurazioni ASA reali. I campi
// semplici e le statistiche indicizzate sono grafici; struct/array e chiavi
// ripetute restano disponibili nell'editor INI avanzato della configurazione.

import { GAME_SETTING_DEFAULTS } from "./gameSettingDefaults";
import { GAME_SETTING_HELP } from "./gameSettingHelp";
import {
  inferGameSettingTags,
  organizeGameSettings,
  type GameSettingTagId,
} from "./gameSettingsTaxonomy";

export type IniValueType = "bool" | "float" | "int" | "string" | "password";

export interface GameSettingField {
  key: string;
  file: "GameUserSettings" | "Game";
  /** Sezione .ini di destinazione, solo se diversa da quella di default del file. */
  section?: string;
  type: IniValueType;
  label: string;
  /** Spiegazione in italiano di cosa fa esattamente l'opzione, mostrata sotto l'etichetta. */
  help?: string;
  /** Valore usato da ASA quando la chiave non viene scritta; null = non documentato/non impostato. */
  defaultValue: string | null;
  /** Testo derivato dal default e mostrato quando l'override è vuoto. */
  placeholder: string;
  /** Valori ammessi: il campo diventa un menu a tendina e ogni altro valore è rifiutato. */
  choices?: { value: string; label: string }[];
  /** Opzione superflua su questo hosting: nascosta nell'editor finché il profilo non ha già un valore. */
  legacy?: boolean;
  /** Vincolo di formato dei campi stringa (vedi configRules.ts). */
  format?: "url";
  /** L'agent scrive il valore fra virgolette doppie nell'INI. */
  quoted?: boolean;
  /** Valore reale gestito fuori dai profili (env/runtime): visibile ma non modificabile. */
  infrastructureManaged?: boolean;
  /** Limiti di validazione e passo, solo per type "int"/"float"; max assente = nessun limite superiore. */
  min?: number;
  max?: number;
  step?: number;
  /** Estremo destro dello slider quando il campo non ha limite superiore di validazione. */
  sliderMax?: number;
  /** Tag tematici normalizzati usati per esplorazione e ricerca trasversale. */
  tags: GameSettingTagId[];
}

export interface GameSettingCategory {
  id: string;
  label: string;
  /** Sintesi della sezione, allineata alle categorie del menu host di ARK. */
  description: string;
  fields: GameSettingField[];
}

const f = (
  key: string,
  file: "GameUserSettings" | "Game",
  type: IniValueType,
  label: string,
  extra?: {
    section?: string;
    help?: string;
    min?: number;
    max?: number;
    step?: number;
    infrastructureManaged?: boolean;
    choices?: { value: string; label: string }[];
    format?: "url";
    quoted?: boolean;
    legacy?: boolean;
  },
): GameSettingField => {
  const defaultValue = GAME_SETTING_DEFAULTS[key];
  if (defaultValue === undefined) throw new Error(`Default ASA mancante per ${key}`);

  // I moltiplicatori (e la difficoltà ufficiale) dell'interfaccia host di ARK
  // lavorano sul profilo 0–6, ma i server privati usano spesso valori ben più
  // alti (taming x85, crescita cuccioli x50000): il profilo resta solo lo slider,
  // la validazione non ha limite superiore e l'input numerico accetta di più.
  const openEnded = (key.includes("Multiplier") || key === "OverrideOfficialDifficulty") && extra?.max !== undefined;
  const max = openEnded ? undefined : extra?.max;
  const sliderMax = openEnded ? Math.min(extra.max as number, 6) : undefined;
  const placeholder = defaultValue === null
    ? "(non impostato)"
    : defaultValue === ""
      ? "(vuoto)"
      : defaultValue;

  // Il passo non deve rendere irraggiungibile il default ASA (es. 0.14 o 0.44 nelle
  // statistiche per livello): per i moltiplicatori frazionari lo si affina a 0.01.
  const defaultNumber = defaultValue === null ? NaN : Number(defaultValue);
  const defaultRatio = extra?.step !== undefined ? defaultNumber / extra.step : 0;
  const step = type === "float" && extra?.step !== undefined && extra.step < 1
    && Number.isFinite(defaultRatio) && Math.abs(defaultRatio - Math.round(defaultRatio)) > 1e-6
    ? 0.01
    : extra?.step;

  const help = extra?.help ?? GAME_SETTING_HELP[key];
  const field = {
    key, file, type, label, ...extra, max, defaultValue, placeholder,
    ...(sliderMax !== undefined ? { sliderMax } : {}),
    ...(help !== undefined ? { help } : {}),
    ...(step !== undefined ? { step } : {}),
  };
  // I tag derivano dal testo: l'help di riserva non deve cambiare categorie e tag già rivisti.
  return { ...field, tags: inferGameSettingTags({ ...field, help: extra?.help }) };
};

// Valori di -ServerPlatform ammessi da ASA: PC, XSX (Xbox Series), PS5 e WINGDK
// (Microsoft Store), combinabili con "+"; ALL le abilita tutte. L'ordine è
// quello usato dal launcher e dalla documentazione (PC+XSX+PS5).
const PLATFORM_NAMES = [
  { id: "PC", label: "PC (Steam/Epic)" },
  { id: "XSX", label: "Xbox" },
  { id: "PS5", label: "PlayStation 5" },
  { id: "WINGDK", label: "Microsoft Store" },
] as const;

const SERVER_PLATFORM_CHOICES: { value: string; label: string }[] = [
  { value: "ALL", label: "Tutte le piattaforme (ALL)" },
  ...Array.from({ length: (1 << PLATFORM_NAMES.length) - 1 }, (_, index) => index + 1)
    .map((mask) => PLATFORM_NAMES.filter((_, bit) => mask & (1 << bit)))
    .filter((selected) => selected.length < PLATFORM_NAMES.length)
    .sort((a, b) => a.length - b.length)
    .map((selected) => ({
      value: selected.map((platform) => platform.id).join("+"),
      label: selected.map((platform) => platform.label).join(" + "),
    })),
];

const STAT_ATTRIBUTES = [
  { id: 0, label: "Salute" },
  { id: 1, label: "Stamina" },
  { id: 2, label: "Torpore" },
  { id: 3, label: "Ossigeno" },
  { id: 4, label: "Cibo" },
  { id: 5, label: "Acqua" },
  { id: 6, label: "Temperatura (non usata)" },
  { id: 7, label: "Peso" },
  { id: 8, label: "Danno corpo a corpo" },
  { id: 9, label: "Velocità movimento" },
  { id: 10, label: "Tempra" },
  { id: 11, label: "Velocità crafting" },
] as const;

const PLAYER_LEVEL_STATS = STAT_ATTRIBUTES.filter(({ id }) => ![2, 6].includes(id));
const DINO_LEVEL_STATS = STAT_ATTRIBUTES.filter(({ id }) => ![6, 10, 11].includes(id));

const indexedStatFields: GameSettingField[] = [
  ...PLAYER_LEVEL_STATS.map(({ id, label }) => f(
    `PerLevelStatsMultiplier_Player[${id}]`, "Game", "float", `${label}: giocatore per livello`,
    { help: `Moltiplica l'incremento di ${label.toLowerCase()} ottenuto quando un giocatore assegna un punto livello. 1.0 usa l'incremento standard.`, min: 0.01, max: 100, step: 0.1 },
  )),
  ...DINO_LEVEL_STATS.flatMap(({ id, label }) => [
    f(`PerLevelStatsMultiplier_DinoWild[${id}]`, "Game", "float", `${label}: dino selvatico`, { help: `Moltiplica ${label.toLowerCase()} ottenuta dai livelli selvatici delle creature.`, min: 0.01, max: 100, step: 0.05 }),
    f(`PerLevelStatsMultiplier_DinoTamed[${id}]`, "Game", "float", `${label}: punto livello dino tame`, { help: `Moltiplica l'incremento di ${label.toLowerCase()} per ogni punto assegnato dopo il tame.`, min: 0.01, max: 100, step: 0.05 }),
    f(`PerLevelStatsMultiplier_DinoTamed_Add[${id}]`, "Game", "float", `${label}: bonus fisso al tame`, { help: `Moltiplica il bonus di ${label.toLowerCase()} aggiunto immediatamente al completamento del tame.`, min: 0.01, max: 100, step: 0.05 }),
    f(`PerLevelStatsMultiplier_DinoTamed_Affinity[${id}]`, "Game", "float", `${label}: efficacia tame`, { help: `Moltiplica il bonus di ${label.toLowerCase()} derivato dall'efficacia di addomesticamento.`, min: 0.01, max: 100, step: 0.05 }),
  ]),
  ...STAT_ATTRIBUTES.map(({ id, label }) => f(
    `PlayerBaseStatMultipliers[${id}]`, "Game", "float", `${label}: valore base giocatore`,
    { help: `Moltiplica il valore iniziale di ${label.toLowerCase()} di un nuovo personaggio. Alcuni attributi non hanno un valore base incrementabile nel gioco.`, min: 0, max: 100, step: 0.1 },
  )),
  ...STAT_ATTRIBUTES.flatMap(({ id, label }) => [
    f(`MutagenLevelBoost[${id}]`, "Game", "int", `${label}: livelli Mutagene (selvatico)`, { help: "Punti livello aggiunti dal Mutagene a creature con ascendenza selvatica.", min: 0, max: 255, step: 1 }),
    f(`MutagenLevelBoost_Bred[${id}]`, "Game", "int", `${label}: livelli Mutagene (allevato)`, { help: "Punti livello aggiunti dal Mutagene a creature allevate.", min: 0, max: 255, step: 1 }),
  ]),
];

const SOURCE_GAME_SETTINGS = [
  {
    id: "general",
    label: "Generale & Sessione",
    fields: [
      f("SessionName", "GameUserSettings", "string", "Nome sessione", { section: "SessionSettings", help: "Nome del server visualizzato nella lista dei server in-game (server browser) e usato per identificarlo tra i giocatori." }),
      // ASA ignora MaxPlayers in /Script/Engine.GameSession: launch.sh legge
      // questo valore dalla sezione privata e genera -WinLiveMaxPlayers.
      f("MaxPlayers", "GameUserSettings", "int", "Giocatori massimi", { section: "ARKSA.Launch", help: "Numero massimo di giocatori contemporanei. In ASA viene applicato all'avvio come -WinLiveMaxPlayers (il vecchio MaxPlayers dell'INI è ignorato).", min: 1, max: 200, step: 1 }),
      f("ServerPassword", "GameUserSettings", "password", "Password server", { help: "Password richiesta ai giocatori per entrare nel server; se lasciata vuota il server è pubblico e chiunque puo' connettersi senza password." }),
      f("ServerAdminPassword", "GameUserSettings", "password", "Password admin", {
        infrastructureManaged: true,
        help: "Credenziale unica amministratore/RCON gestita dall'infrastruttura e mai salvata nei profili o restituita agli utenti. Per i comandi in gioco usa enablecheats con il segreto operativo corrente.",
      }),
      f("SpectatorPassword", "GameUserSettings", "password", "Password spettatore", { help: "Password che permette ai giocatori di entrare direttamente in modalità spettatore invece che nel mondo di gioco normale; se lasciata vuota la modalità spettatore è disabilitata." }),
      f("MultiHome", "GameUserSettings", "string", "IP MultiHome", { section: "SessionSettings", legacy: true, help: "Non necessaria su questo hosting: il game server in container ha una sola interfaccia di rete e il launcher non passa l'indirizzo a -MULTIHOME. Non impostarla; compare solo nei profili che l'avevano già valorizzata." }),
      f("serverPVE", "GameUserSettings", "bool", "Modalità PvE", { help: "Se attivo disabilita il danno diretto tra giocatori e tra strutture di tribù diverse (Player vs Environment), impedendo PvP e raid tra tribù non alleate." }),
      f("ServerHardcore", "GameUserSettings", "bool", "Hardcore (morte = livello 1)", { help: "Se attivo, alla morte il personaggio perde tutti i livelli guadagnati e riparte dal livello 1, rendendo la morte molto piu' punitiva rispetto alla modalità normale." }),
      f("ServerCrosshair", "GameUserSettings", "bool", "Mirino attivo", { help: "Se attivo mostra un mirino/reticolo al centro dello schermo per tutti i giocatori, anche quando non hanno un'arma equipaggiata." }),
      f("ServerForceNoHUD", "GameUserSettings", "bool", "Nascondi HUD creature non possedute", { help: "Se attivo nasconde ai giocatori la barra salute/stamina e le altre informazioni HUD relative alle creature che non possiedono, riducendo le informazioni disponibili durante gli scontri con dino selvatici o nemici." }),
      f("ShowMapPlayerLocation", "GameUserSettings", "bool", "Mostra posizione sulla mappa", { help: "Se attivo mostra sulla mappa la posizione del giocatore stesso; se disattivato il giocatore deve orientarsi senza un indicatore della propria posizione sulla mappa." }),
      f("ProximityChat", "GameUserSettings", "bool", "Chat solo di prossimità", { help: "Se attivo la chat vocale funziona solo tra giocatori fisicamente vicini nel mondo di gioco, in stile walkie-talkie basato sulla distanza." }),
      f("globalVoiceChat", "GameUserSettings", "bool", "Voce globale (non di prossimità)", { help: "Se attivo la chat vocale è udibile da tutti i giocatori connessi al server indipendentemente dalla distanza, ignorando la prossimità." }),
      f("AutoSavePeriodMinutes", "GameUserSettings", "float", "Intervallo autosalvataggio (min)", { help: "Intervallo in minuti tra un salvataggio automatico del mondo di gioco e il successivo; valori piu' bassi riducono la perdita di progressi in caso di crash ma aumentano il carico sul server durante il salvataggio.", min: 1, max: 60, step: 1 }),
      f("KickIdlePlayersPeriod", "GameUserSettings", "float", "Kick giocatori inattivi dopo (sec)", { help: "Tempo in secondi di inattività (nessun input dal giocatore) oltre il quale un giocatore viene automaticamente disconnesso dal server; richiede il flag di avvio -EnableIdlePlayerKick per essere applicato.", min: 0, max: 3600, step: 60 }),
      f("AdminLogging", "GameUserSettings", "bool", "Log comandi admin in chat", { help: "Se attivo registra e mostra in chat tutti i comandi admin eseguiti sul server, utile per tenere traccia dell'uso dei privilegi di amministrazione." }),
      f("RCONPort", "GameUserSettings", "int", "Porta RCON", { infrastructureManaged: true, help: "Gestita dall'infrastruttura: la porta RCON è condivisa con l'agent (stato, salvataggi e spegnimento automatico) e non è modificabile per profilo.", min: 1, max: 65535, step: 1 }),
      f("RCONServerGameLogBuffer", "GameUserSettings", "float", "Buffer log RCON", { help: "Numero massimo di righe di log di gioco mantenute nel buffer consultabile via RCON (es. con il comando getgamelog); superato il limite le righe piu' vecchie vengono scartate.", min: 100, max: 5000, step: 100 }),
      f("BanListURL", "GameUserSettings", "string", "URL lista ban", { format: "url", quoted: true, help: "Indirizzo di un file di testo esterno contenente l'elenco degli ID Steam/EOS bannati, scaricato periodicamente dal server. Inserisci solo l'indirizzo http(s): le virgolette richieste dal file ini vengono aggiunte automaticamente." }),
    ],
  },
  {
    id: "rates",
    label: "Difficoltà & Moltiplicatori",
    fields: [
      f("DifficultyOffset", "GameUserSettings", "float", "Difficoltà (0-1)", { help: "Regola la difficoltà di base del server, usata insieme a OverrideOfficialDifficulty per calcolare il livello massimo delle creature e la qualità del loot secondo la formula DifficultyOffset*(OverrideOfficialDifficulty-0.5)+0.5; non puo' superare il valore 1.0.", min: 0.01, max: 1, step: 0.01 }),
      f("OverrideOfficialDifficulty", "GameUserSettings", "float", "Override difficoltà ufficiale", { help: "Sostituisce il valore di difficoltà ufficiale usato per calcolare il livello massimo delle creature selvatiche e la qualità del loot; ad esempio un valore di 5.0 porta il livello massimo dei dino a circa 150.", min: 0, max: 6, step: 0.1 }),
      f("XPMultiplier", "GameUserSettings", "float", "Moltiplicatore XP", { help: "Moltiplica la quantità di punti esperienza guadagnati da qualsiasi fonte rispetto al valore ufficiale (1.0 = tasso normale).", min: 0, max: 20, step: 0.05 }),
      f("TamingSpeedMultiplier", "GameUserSettings", "float", "Velocità taming", { help: "Moltiplica la velocità con cui procede l'addomesticamento delle creature: valori piu' alti riducono il tempo necessario per completare il taming (1.0 = velocità ufficiale).", min: 0, max: 100, step: 0.05 }),
      f("HarvestAmountMultiplier", "GameUserSettings", "float", "Raccolta risorse", { help: "Moltiplica la quantità di risorse ottenute per ogni singola azione di raccolta, ad esempio i colpi su un albero o una roccia (1.0 = quantità ufficiale).", min: 0, max: 20, step: 0.05 }),
      f("HarvestHealthMultiplier", "GameUserSettings", "float", "Resistenza risorse raccoglibili", { help: "Moltiplica i \"punti vita\" delle risorse raccoglibili (alberi, rocce, cespugli), determinando quanti colpi servono per esaurirle prima che scompaiano (1.0 = valore ufficiale).", min: 0, max: 10, step: 0.1 }),
      f("ResourcesRespawnPeriodMultiplier", "GameUserSettings", "float", "Respawn risorse", { help: "Moltiplica il tempo che intercorre prima che una risorsa raccolta ricompaia nel mondo di gioco: valori inferiori a 1.0 accelerano il respawn, valori superiori lo rallentano.", min: 0, max: 10, step: 0.1 }),
      f("DinoCountMultiplier", "GameUserSettings", "float", "Popolazione dino selvatici", { help: "Moltiplica il numero massimo di creature selvatiche che possono esistere contemporaneamente sulla mappa rispetto al valore ufficiale (1.0 = densità normale).", min: 0, max: 5, step: 0.1 }),
      f("ItemStackSizeMultiplier", "GameUserSettings", "float", "Dimensione stack oggetti", { help: "Moltiplica la dimensione massima degli stack di oggetti nell'inventario rispetto al valore base di ciascun oggetto (1.0 = dimensione ufficiale); valori alti sono spesso usati per ridurre la gestione dell'inventario.", min: 0, max: 100, step: 0.05 }),
      f("KillXPMultiplier", "Game", "float", "XP da uccisioni", { help: "Moltiplica in modo specifico l'esperienza ottenuta uccidendo creature, in aggiunta al moltiplicatore generico XPMultiplier.", min: 0, max: 20, step: 0.05 }),
      f("HarvestXPMultiplier", "Game", "float", "XP da raccolta", { help: "Moltiplica in modo specifico l'esperienza ottenuta raccogliendo risorse, in aggiunta al moltiplicatore generico XPMultiplier.", min: 0, max: 20, step: 0.05 }),
      f("CraftXPMultiplier", "Game", "float", "XP da crafting", { help: "Moltiplica in modo specifico l'esperienza ottenuta craftando oggetti, in aggiunta al moltiplicatore generico XPMultiplier.", min: 0, max: 20, step: 0.05 }),
      f("GenericXPMultiplier", "Game", "float", "XP generico", { help: "Moltiplica l'esperienza ottenuta da azioni generiche non coperte dalle altre categorie specifiche (uccisioni, raccolta, crafting), in aggiunta a XPMultiplier.", min: 0, max: 20, step: 0.05 }),
      f("SpecialXPMultiplier", "Game", "float", "XP da azioni speciali", { help: "Moltiplica l'esperienza ottenuta da azioni speciali, come missioni o eventi specifici della mappa, in aggiunta a XPMultiplier.", min: 0, max: 20, step: 0.05 }),
      f("CustomRecipeEffectivenessMultiplier", "Game", "float", "Efficacia ricette custom", { help: "Moltiplica l'efficacia, cioè la potenza dell'effetto, delle ricette personalizzate di cucina/chimica craftate dai giocatori (1.0 = efficacia base).", min: 0, max: 10, step: 0.1 }),
      f("CustomRecipeSkillMultiplier", "Game", "float", "Skill nelle ricette custom", { help: "Moltiplica il bonus di abilità di crafting (Crafting Skill) del personaggio applicato all'efficacia delle ricette personalizzate craftate (1.0 = bonus base).", min: 0, max: 10, step: 0.1 }),
    ],
  },
  {
    id: "player",
    label: "Giocatore",
    fields: [
      f("PlayerCharacterFoodDrainMultiplier", "GameUserSettings", "float", "Consumo cibo", { help: "Moltiplicatore della velocità con cui si consuma la statistica Cibo (fame) del personaggio nel tempo. Un valore più alto svuota la fame più rapidamente, un valore di 0 blocca completamente il consumo di cibo. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("PlayerCharacterWaterDrainMultiplier", "GameUserSettings", "float", "Consumo acqua", { help: "Moltiplicatore della velocità con cui si consuma la statistica Acqua (sete) del personaggio nel tempo. Un valore più alto svuota la sete più rapidamente, 0 blocca il consumo. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("PlayerCharacterStaminaDrainMultiplier", "GameUserSettings", "float", "Consumo stamina", { help: "Moltiplicatore della velocità di consumo della stamina durante corsa, salto, nuoto e arrampicata. Valori più bassi permettono di sostenere sforzi più a lungo prima di esaurirsi. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("PlayerCharacterHealthRecoveryMultiplier", "GameUserSettings", "float", "Recupero salute", { help: "Moltiplicatore della velocità di rigenerazione naturale della salute del personaggio nel tempo (rigenerazione passiva, non cure). Default 1.0, 0 disattiva la rigenerazione naturale.", min: 0, max: 10, step: 0.1 }),
      f("PlayerDamageMultiplier", "GameUserSettings", "float", "Danno inflitto dal giocatore", { help: "Moltiplicatore del danno inflitto dal giocatore con armi, attacchi in mischia e strumenti verso creature, altri giocatori e strutture. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("PlayerResistanceMultiplier", "GameUserSettings", "float", "Resistenza al danno del giocatore", { help: "Moltiplicatore della resistenza al danno subito dal giocatore: valori più alti riducono il danno incassato da attacchi di creature, altri giocatori e cadute. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("PreventSpawnAnimations", "GameUserSettings", "bool", "Disabilita animazioni di respawn", { help: "Se attivo, disabilita l'animazione di teletrasporto/comparsa che accompagna il respawn del personaggio, facendolo apparire e diventare subito controllabile senza l'attesa dell'effetto grafico." }),
      f("AllowThirdPersonPlayer", "GameUserSettings", "bool", "Consenti telecamera in terza persona", { help: "Se attivo, consente ai giocatori di passare alla visuale in terza persona oltre alla prima persona; se disattivato la visuale è bloccata in prima persona." }),
      f("AllowHitMarkers", "GameUserSettings", "bool", "Mostra hit marker", { help: "Se attivo, mostra un indicatore visivo (hit marker) al centro dello schermo quando un attacco del giocatore colpisce con successo un bersaglio." }),
      f("ShowFloatingDamageText", "GameUserSettings", "bool", "Numeri di danno a schermo", { help: "Se attivo, mostra i numeri del danno inflitto e subito che compaiono fluttuando sopra i bersagli colpiti in combattimento." }),
      f("DisablePvEGamma", "GameUserSettings", "bool", "Blocca comando gamma in PvE", { help: "Su server impostati in modalità PvE, se attivo impedisce ai giocatori di usare il comando console per modificare la gamma/luminosità dello schermo, evitando che qualcuno schiarisca artificialmente la visuale notturna." }),
      f("EnablePvPGamma", "GameUserSettings", "bool", "Consenti comando gamma in PvP", { help: "Su server impostati in modalità PvP, dove il comando gamma è normalmente bloccato, questa opzione lo riabilita esplicitamente permettendo ai giocatori di modificare la luminosità dello schermo." }),
      f("PreventDiseases", "GameUserSettings", "bool", "Disabilita malattie", { help: "Se attivo, impedisce del tutto che i giocatori possano contrarre malattie (es. febbre della palude, malattia da vicinanza) da creature o ambiente." }),
      f("NonPermanentDiseases", "GameUserSettings", "bool", "Malattie non permanenti", { help: "Se attivo, le malattie contratte dal giocatore non restano permanenti finché non vengono curate con un rimedio, ma tendono a risolversi da sole (ad esempio alla disconnessione), risultando meno punitive." }),
      f("ImplantSuicideCD", "GameUserSettings", "float", "Cooldown suicidio da impianto (sec)", { help: "Tempo di attesa, in secondi, che il giocatore deve rispettare tra un utilizzo e l'altro della funzione di suicidio tramite il proprio impianto. Il valore predefinito è 28800 secondi, cioè 8 ore.", min: 0, max: 86400, step: 300 }),
    ],
  },
  {
    id: "dino",
    label: "Dino & Creature",
    fields: [
      f("DinoCharacterFoodDrainMultiplier", "GameUserSettings", "float", "Consumo cibo dino", { help: "Moltiplicatore della velocità di consumo della statistica Cibo dei dinosauri, sia selvatici sia addomesticati. Valori più alti li fanno affamare più in fretta, 0 blocca il consumo di cibo. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("DinoCharacterStaminaDrainMultiplier", "GameUserSettings", "float", "Consumo stamina dino", { help: "Moltiplicatore della velocità di consumo della stamina dei dinosauri durante sprint, volo o altre azioni che la richiedono. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("DinoCharacterHealthRecoveryMultiplier", "GameUserSettings", "float", "Recupero salute dino", { help: "Moltiplicatore della velocità di rigenerazione naturale della salute dei dinosauri nel tempo. Default 1.0, 0 disattiva la rigenerazione passiva.", min: 0, max: 10, step: 0.1 }),
      f("DinoDamageMultiplier", "GameUserSettings", "float", "Danno dino selvatici", { help: "Moltiplicatore del danno inflitto dai dinosauri selvatici (non addomesticati) in combattimento. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("DinoResistanceMultiplier", "GameUserSettings", "float", "Resistenza dino selvatici", { help: "Moltiplicatore della resistenza al danno dei dinosauri selvatici: valori più alti riducono il danno che subiscono, rendendoli più difficili da abbattere o addomesticare con la forza. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("TamedDinoDamageMultiplier", "GameUserSettings", "float", "Danno dino addomesticati", { help: "Moltiplicatore del danno inflitto dai dinosauri addomesticati (cavalcati o meno) in combattimento. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("TamedDinoResistanceMultiplier", "GameUserSettings", "float", "Resistenza dino addomesticati", { help: "Moltiplicatore della resistenza al danno dei dinosauri addomesticati: valori più alti riducono il danno che subiscono in combattimento. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("MaxTamedDinos", "GameUserSettings", "float", "Dino addomesticati max (server)", { help: "Numero massimo di dinosauri addomesticati che possono esistere contemporaneamente su tutto il server; una volta raggiunto il limite non è più possibile completare nuove tame. Default 5000.", min: 0, max: 20000, step: 100 }),
      f("MaxPersonalTamedDinos", "GameUserSettings", "int", "Dino addomesticati max (tribù)", { help: "Numero massimo di dinosauri addomesticati che una singola tribù (o giocatore solitario) può possedere contemporaneamente. Il valore 0 indica nessun limite per tribù.", min: 0, max: 1000, step: 5 }),
      f("PreventMateBoost", "GameUserSettings", "bool", "Disabilita mate boost", { help: "Se attivo, disabilita il bonus temporaneo di danno e resistenza che due dinosauri ricevono quando si accoppiano nelle vicinanze." }),
      f("AllowRaidDinoFeeding", "GameUserSettings", "bool", "Alimentazione permanente Titanosauro", { help: "Se attivo, consente di nutrire manualmente i dino da raid come il Titanosauro (che normalmente non possono essere nutriti e muoiono dopo circa 24 ore dalla cattura)." }),
      f("RaidDinoCharacterFoodDrainMultiplier", "GameUserSettings", "float", "Consumo cibo dino da raid", { help: "Moltiplicatore della velocità di consumo del cibo dei dino da raid (es. Titanosauro) quando AllowRaidDinoFeeding è attivo. Impostato a 0 il cibo non cala mai, rendendo la creatura permanente.", min: 0, max: 10, step: 0.1 }),
      f("DisableImprintDinoBuff", "GameUserSettings", "bool", "Disabilita bonus imprinting", { help: "Se attivo, disabilita il bonus di statistiche (danno e resistenza extra) che un dinosauro riceve quando viene cavalcato dal giocatore che ha effettuato l'imprinting su di esso." }),
      f("DisableDinoDecayPvE", "GameUserSettings", "bool", "Disabilita decadimento dino (PvE)", { help: "Su server PvE, se attivo disabilita il decadimento automatico dei dinosauri addomesticati non visitati/reclamati, che altrimenti diventano reclamabili da altri dopo un certo periodo." }),
      f("PvEDinoDecayPeriodMultiplier", "GameUserSettings", "float", "Periodo decadimento dino (PvE)", { help: "Su server PvE, moltiplica il periodo di tempo che deve trascorrere prima che un dinosauro addomesticato non visitato dal proprietario venga considerato decaduto e reclamabile da altri. Valori più alti allungano questo periodo. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("AllowFlyerCarryPvE", "GameUserSettings", "bool", "Volanti possono rapire dino (PvE)", { help: "Su server PvE, se attivo consente ai dinosauri volanti di afferrare e trasportare in volo altri dinosauri, funzione normalmente disabilitata in PvE per evitare furti o smarrimenti accidentali." }),
      f("AllowFlyingStaminaRecovery", "GameUserSettings", "bool", "Recupero stamina in volo", { help: "Se attivo, consente ai dinosauri volanti di rigenerare stamina anche mentre sono in volo; normalmente la stamina dei volanti si rigenera solo quando sono atterrati." }),
      f("AllowAnyoneBabyImprintCuddle", "GameUserSettings", "bool", "Chiunque può fare imprinting", { help: "Se attivo, permette a qualsiasi giocatore, non solo a chi ha avviato l'imprinting, di effettuare le coccole (cuddle) sui cuccioli per far progredire la percentuale di imprinting." }),
      f("OxygenSwimSpeedStatMultiplier", "GameUserSettings", "float", "Velocità nuoto da ossigeno", { help: "Moltiplicatore di quanto la statistica Ossigeno del personaggio o della creatura influisce sulla velocità di nuoto: valori più alti rendono ogni punto investito in Ossigeno più efficace per nuotare veloce. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("ServerAutoForceRespawnWildDinosInterval", "GameUserSettings", "float", "Intervallo respawn forzato dino (sec)", { help: "Intervallo in secondi con cui il server forza automaticamente una pulizia e un ripopolamento dei dinosauri selvatici su tutta la mappa. Il default 0 disattiva il respawn forzato periodico.", min: 0, max: 604800, step: 3600 }),
      f("ExtinctionEventTimeInterval", "GameUserSettings", "int", "Intervallo ARKpocalypse (sec)", { help: "Intervallo in secondi tra un evento ARKpocalypse (ondata periodica di creature aggressive e fenomeni ambientali) e il successivo. Il valore 0, predefinito, disattiva questi eventi periodici forzati.", min: 0, max: 604800, step: 3600 }),
      f("UseOptimizedHarvestingHealth", "GameUserSettings", "bool", "Raccolta ottimizzata con moltiplicatori alti", { help: "Se attivo, ottimizza il modo in cui vengono calcolati i punti salute delle risorse raccoglibili, raggruppando gli oggetti ottenuti da un colpo invece di elaborarli uno per uno. Consigliato quando si usano moltiplicatori di raccolta molto alti per ridurre il carico sul server." }),
      f("MatingIntervalMultiplier", "Game", "float", "Intervallo tra accoppiamenti", { help: "Moltiplicatore del tempo di attesa (cooldown) che una coppia di dinosauri deve rispettare tra un accoppiamento e il successivo. Valori più bassi permettono accoppiamenti più frequenti. Default 1.0.", min: 0, max: 10, step: 0.05 }),
      f("MatingSpeedMultiplier", "Game", "float", "Velocità accoppiamento", { help: "Moltiplicatore della velocità con cui procede la barra di progresso dell'accoppiamento tra due dinosauri compatibili. Valori più alti completano l'accoppiamento più rapidamente. Default 1.0.", min: 0, max: 50, step: 0.05 }),
      f("EggHatchSpeedMultiplier", "Game", "float", "Velocità schiusa uova", { help: "Moltiplicatore della velocità con cui le uova fecondate giungono a schiusa. Valori più alti fanno schiudere le uova molto più in fretta. Default 1.0.", min: 0, max: 50, step: 0.05 }),
      f("LayEggIntervalMultiplier", "Game", "float", "Intervallo deposizione uova", { help: "Moltiplicatore dell'intervallo di tempo tra una deposizione di uova e la successiva da parte delle femmine ovipare addomesticate. Valori più bassi fanno deporre uova più spesso. Default 1.0.", min: 0, max: 10, step: 0.05 }),
      f("BabyMatureSpeedMultiplier", "Game", "float", "Velocità crescita cuccioli", { help: "Moltiplicatore della velocità di crescita dei cuccioli/neonati fino a raggiungere l'età adulta. Valori più alti riducono drasticamente il tempo necessario per la maturazione. Default 1.0.", min: 0, max: 50, step: 0.05 }),
      f("BabyFoodConsumptionSpeedMultiplier", "Game", "float", "Consumo cibo cuccioli", { help: "Moltiplicatore della velocità con cui i cuccioli consumano il proprio cibo durante la crescita. Va tipicamente regolato insieme a BabyMatureSpeedMultiplier: se i cuccioli crescono molto più in fretta serve aumentare anche questo valore perché abbiano abbastanza cibo per tutta la fase di crescita. Default 1.0.", min: 0, max: 50, step: 0.05 }),
      f("BabyCuddleIntervalMultiplier", "Game", "float", "Intervallo coccole cuccioli", { help: "Moltiplicatore dell'intervallo di tempo tra una finestra utile per le coccole (cuddle) di imprinting e la successiva. Valori più bassi rendono le richieste di coccole più frequenti. Default 1.0.", min: 0, max: 10, step: 0.05 }),
      f("BabyCuddleGracePeriodMultiplier", "Game", "float", "Tempo di grazia coccole", { help: "Moltiplicatore della durata del periodo di grazia entro cui è possibile effettuare la coccola richiesta prima che la finestra si chiuda senza penalità. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("BabyCuddleLoseImprintQualitySpeedMultiplier", "Game", "float", "Velocità perdita qualità imprinting", { help: "Moltiplicatore della velocità con cui si perde qualità di imprinting se la finestra di coccole viene mancata. Impostato a 0 la qualità di imprinting non si perde mai. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("BabyImprintingStatScaleMultiplier", "Game", "float", "Bonus statistiche da imprinting", { help: "Moltiplicatore del bonus alle statistiche (salute, danno e altre) che un dinosauro riceve per ogni punto percentuale di imprinting raggiunto. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("BabyImprintAmountMultiplier", "Game", "float", "Quantità imprinting per coccola", { help: "Moltiplicatore della quantità di percentuale di imprinting guadagnata ogni volta che viene effettuata con successo una coccola sul cucciolo. Default 1.0.", min: 0, max: 10, step: 0.1 }),
      f("HairGrowthSpeedMultiplier", "Game", "float", "Velocità crescita pelo/criniera", { help: "Moltiplicatore della velocità di crescita di pelo e criniera dei dinosauri che li producono (es. Woolly Rhino, Direwolf), rilevante per chi effettua la tosatura periodica della lana. In ASA il default è 0.", min: 0, max: 10, step: 0.1 }),
    ],
  },
  {
    id: "structures",
    label: "Strutture",
    fields: [
      f("StructureDamageMultiplier", "GameUserSettings", "float", "Danno alle strutture", { help: "Moltiplicatore del danno che le strutture con capacità offensiva (es. muri con picche) infliggono quando colpiscono creature o giocatori. Il valore predefinito 1 corrisponde al danno normale; valori più alti aumentano il danno inflitto, valori più bassi lo riducono.", min: 0, max: 10, step: 0.05 }),
      f("StructureResistanceMultiplier", "GameUserSettings", "float", "Resistenza strutture", { help: "Moltiplicatore della resistenza al danno subito dalle strutture quando vengono attaccate. Il default 1 è la resistenza normale: valori più bassi rendono le strutture più resistenti (es. 0.5 dimezza il danno subito), valori più alti le rendono più fragili (2.0 raddoppia il danno subito).", min: 0, max: 10, step: 0.05 }),
      f("AlwaysAllowStructurePickup", "GameUserSettings", "bool", "Rimuovi limite tempo pick-up rapido", { help: "Se attivo, disabilita il timer del sistema di raccolta rapida (pick-up): qualsiasi struttura può essere ripresa in inventario in qualsiasi momento, indipendentemente da quanto tempo è passato dal posizionamento." }),
      f("StructurePickupHoldDuration", "GameUserSettings", "float", "Durata pressione pick-up rapido", { help: "Durata in secondi della pressione prolungata necessaria per il pick-up rapido di una struttura. Un valore di 0 rende il pick-up istantaneo (nessuna pressione richiesta).", min: 0, max: 5, step: 0.1 }),
      f("StructurePickupTimeAfterPlacement", "GameUserSettings", "float", "Finestra pick-up dopo posa (sec)", { help: "Finestra di tempo in secondi dopo il posizionamento entro cui una struttura può ancora essere ripresa con il pick-up rapido; scaduta questa finestra va rimossa normalmente.", min: 0, max: 300, step: 5 }),
      f("AutoDestroyOldStructuresMultiplier", "GameUserSettings", "float", "Auto-distruzione strutture abbandonate", { help: "Moltiplicatore che consente l'auto-distruzione delle strutture solo dopo che è trascorso un tempo sufficiente senza tribù nelle vicinanze (calcolato come multiplo del periodo di rivendicazione). A 0 la funzione è disattivata; impostare 1.0 per attivarla al ritmo standard. Richiede anche l'opzione da riga di comando -AutoDestroyStructures per funzionare.", min: 0, max: 10, step: 0.1 }),
      f("OnlyAutoDestroyCoreStructures", "GameUserSettings", "bool", "Auto-distruzione solo fondamenta", { help: "Se attivo, impedisce l'auto-distruzione automatica delle strutture non fondamentali (non fondamenta/pilastri); vengono comunque rimosse se la struttura portante su cui poggiano viene distrutta. Usata sui server PvE ufficiali." }),
      f("FastDecayUnsnappedCoreStructures", "GameUserSettings", "bool", "Decadimento rapido fondamenta isolate", { help: "Se attivo, fondamenta, pilastri, recinzioni e Tek Dedicated Storage non agganciati ad altre strutture decadono più rapidamente, secondo l'intervallo definito da FastDecayInterval in Game.ini (12 ore di default)." }),
      f("OnlyDecayUnsnappedCoreStructures", "GameUserSettings", "bool", "Decadimento solo fondamenta isolate", { help: "Se attivo, solo le strutture fondamentali (fondamenta/pilastri) non agganciate ad altre strutture subiscono il decadimento; utile per eliminare fondamenta o pilastri isolati e abbandonati senza intaccare basi complete." }),
      f("DisableStructureDecayPvE", "GameUserSettings", "bool", "Disabilita decadimento strutture (PvE)", { help: "Se attivo, disabilita completamente il decadimento automatico graduale delle strutture dei giocatori in modalità PvE." }),
      f("PvEStructureDecayPeriodMultiplier", "GameUserSettings", "float", "Periodo decadimento strutture (PvE)", { help: "Moltiplicatore del tempo di decadimento delle strutture: un valore di 2.0 raddoppia il tempo necessario al decadimento, 0.5 lo dimezza. Nonostante il nome si applica sia in PvE sia in PvP quando il decadimento delle strutture è attivo.", min: 0, max: 10, step: 0.1 }),
      f("ForceAllStructureLocking", "GameUserSettings", "bool", "Blocca strutture per default", { help: "Se attivo, tutte le strutture vengono bloccate (pin/lock) per impostazione predefinita al momento della posa, invece di restare sbloccate." }),
      f("MaxGateFrameOnSaddles", "GameUserSettings", "int", "Portali max su piattaforme", { help: "Numero massimo di intelaiature per portale posizionabili su selle-piattaforma. Impostato a 0 impedisce del tutto di piazzare portali sulle piattaforme (come sui server PvE ufficiali); non è retroattivo sulle costruzioni già esistenti.", min: 0, max: 10, step: 1 }),
      f("MaxPlatformSaddleStructureLimit", "GameUserSettings", "int", "Strutture max su piattaforme", { help: "Numero massimo di creature con sella-piattaforma (incluse zattere/imbarcazioni con strutture) che possono esistere contemporaneamente su tutto il server, non il numero di strutture costruibili su una singola piattaforma.", min: 0, max: 500, step: 5 }),
      f("PerPlatformMaxStructuresMultiplier", "GameUserSettings", "float", "Moltiplicatore strutture per piattaforma", { help: "Moltiplicatore percentuale del numero massimo di strutture posizionabili su ciascuna sella-piattaforma o zattera. Valori più alti aumentano quante strutture possono essere costruite su una singola piattaforma.", min: 0, max: 10, step: 0.1 }),
      f("PlatformSaddleBuildAreaBoundsMultiplier", "GameUserSettings", "float", "Area costruibile su piattaforma", { help: "Aumentando il valore, consente di posizionare strutture più lontano dai bordi della sella-piattaforma/zattera su cui sono ancorate, allargando l'area costruibile.", min: 0, max: 10, step: 0.1 }),
      f("PersonalTamedDinosSaddleStructureCost", "GameUserSettings", "int", "Costo slot tame per struttura piattaforma", { help: "Numero di slot tame della tribù consumati da ogni creatura con sella-piattaforma su cui sono state costruite strutture (es. zattere armate). Il default 0 disattiva questo costo aggiuntivo; sugli ufficiali è stato impostato a 19.", min: 0, max: 100, step: 1 }),
      f("TheMaxStructuresInRange", "GameUserSettings", "int", "Strutture max in un'area", { help: "Numero massimo di strutture costruibili entro un raggio (attualmente fisso nel codice del gioco) attorno a un punto della mappa; superato questo limite non è più possibile costruire in quell'area.", min: 0, max: 20000, step: 100 }),
      f("EnableExtraStructurePreventionVolumes", "GameUserSettings", "bool", "Blocca costruzioni in zone risorsa", { help: "Se attivo, impedisce la costruzione in specifiche aree ricche di risorse, in particolare quelle attorno alle montagne principali su The Island." }),
      f("StructurePreventResourceRadiusMultiplier", "GameUserSettings", "float", "Raggio prevenzione risorse", { help: "Moltiplicatore del raggio attorno alle strutture entro cui le risorse (alberi, rocce, cespugli) non si rigenerano. Equivale a ResourceNoReplenishRadiusStructures di Game.ini; se entrambe le impostazioni sono presenti gli effetti si sommano.", min: 0, max: 10, step: 0.1 }),
      f("OverrideStructurePlatformPrevention", "GameUserSettings", "bool", "Consenti torrette su piattaforme", { help: "Se attivo, consente di costruire e far funzionare torrette automatiche (e muri con picche) sulle selle-piattaforma, normalmente vietate su tali strutture." }),
      f("AllowIntegratedSPlusStructures", "GameUserSettings", "bool", "Includi strutture S+ integrate", { help: "Se disattivato, disabilita tutte le nuove strutture integrate in stile S+; pensato per i server non ufficiali che vogliono continuare a usare la versione mod di S+ senza duplicati. Attivo per default." }),
      f("AllowCaveBuildingPvE", "GameUserSettings", "bool", "Costruzione in grotte (PvE)", { help: "Se attivo, consente di costruire strutture all'interno delle grotte quando è abilitata anche la modalità PvE." }),
      f("AllowCaveBuildingPvP", "GameUserSettings", "bool", "Costruzione in grotte (PvP)", { help: "Se disattivato, impedisce di costruire strutture all'interno delle grotte quando è abilitata la modalità PvP. Attivo (costruzione permessa) per default." }),
      f("AllowMultipleAttachedC4", "GameUserSettings", "bool", "Consenti più C4 sulla stessa creatura", { help: "Se attivo, consente di piazzare più di una carica di C4 sulla stessa creatura contemporaneamente." }),
      f("AutoDestroyDecayedDinos", "GameUserSettings", "bool", "Auto-distruggi dino abbandonati", { help: "Se attivo, le creature addomesticate rivendicabili (decadute per assenza di tribù) vengono distrutte automaticamente al caricamento del server, invece di restare disponibili per essere rivendicate." }),
      f("bDisableStructurePlacementCollision", "Game", "bool", "Disabilita collisioni posizionamento", { help: "Se attivo, disabilita il controllo delle collisioni durante il posizionamento delle strutture, permettendo di sovrapporle o incastrarle nel terreno e tra loro senza i normali vincoli geometrici di piazzamento." }),
    ],
  },
  {
    id: "world",
    label: "Ambiente & Mondo",
    fields: [
      f("DayCycleSpeedScale", "GameUserSettings", "float", "Velocità ciclo giorno/notte", { help: "Moltiplicatore della velocità di scorrimento dell'intero ciclo giorno/notte. Il valore predefinito 1 riproduce la stessa velocità del gioco in singolo giocatore; valori più bassi rallentano il ciclo (giorni e notti più lunghi), valori più alti lo accelerano.", min: 0, max: 5, step: 0.01 }),
      f("DayTimeSpeedScale", "GameUserSettings", "float", "Velocità scorrimento giorno", { help: "Moltiplicatore della velocità di scorrimento del tempo durante il giorno, relativo alla durata della notte (impostata da NightTimeSpeedScale). Abbassando il valore si allunga la durata di ogni giorno.", min: 0, max: 5, step: 0.01 }),
      f("NightTimeSpeedScale", "GameUserSettings", "float", "Velocità scorrimento notte", { help: "Moltiplicatore della velocità di scorrimento del tempo durante la notte, relativo alla durata del giorno (impostata da DayTimeSpeedScale). Abbassando il valore si allunga la durata di ogni notte.", min: 0, max: 5, step: 0.01 }),
      f("DisableWeatherFog", "GameUserSettings", "bool", "Disabilita nebbia atmosferica", { help: "Se attivo, disabilita la nebbia atmosferica generata dagli effetti meteo sulla mappa." }),
      f("RandomSupplyCratePoints", "GameUserSettings", "bool", "Punti supply crate casuali", { help: "Se attivo, i supply crate (rifornimenti) compaiono in posizioni casuali invece che nei punti di caduta prestabiliti della mappa. Su Ragnarok è noto per rendere alcuni artefatti inaccessibili se attivo." }),
      f("PvEAllowStructuresAtSupplyDrops", "GameUserSettings", "bool", "Consenti costruzioni vicino ai drop", { help: "Se attivo, consente di costruire strutture vicino ai punti di caduta dei supply crate in modalità PvE, normalmente vietato per non bloccarne l'atterraggio." }),
      f("AllowCrateSpawnsOnTopOfStructures", "GameUserSettings", "bool", "Supply crate sopra le strutture", { help: "Se attivo, consente ai supply crate lanciati dall'alto di comparire sopra le strutture dei giocatori, invece di essere impediti dalla presenza di strutture in quel punto." }),
      f("ClampResourceHarvestDamage", "GameUserSettings", "bool", "Limita danno di raccolta risorse", { help: "Se attivo, limita il danno che una creatura può infliggere a una risorsa durante la raccolta in base alla salute residua della risorsa, riducendo la resa ottenibile con strumenti o creature ad alto danno." }),
      f("ClampItemSpoilingTimes", "GameUserSettings", "bool", "Limita tempi di deperimento massimi", { help: "Se attivo, forza tutti i tempi di deperimento degli oggetti al loro valore massimo previsto; utile per correggere exploit che avevano reso alcuni oggetti a deperimento infinito o eccessivamente lento." }),
      f("ClampItemStats", "GameUserSettings", "bool", "Applica clamp alle statistiche oggetti", { help: "Se attivo, applica un limite massimo (clamp) alle statistiche generate casualmente sugli oggetti, secondo i valori definiti nella sezione ItemStatClamps di Game.ini." }),
      f("GlobalSpoilingTimeMultiplier", "Game", "float", "Tempo di deperimento globale", { help: "Moltiplicatore globale del tempo di deperimento di tutti gli oggetti deperibili (cibo compreso). Valori più alti allungano il tempo prima che un oggetto si deteriori, valori più bassi lo accorciano. Va impostato in Game.ini.", min: 0, max: 10, step: 0.05 }),
      f("GlobalItemDecompositionTimeMultiplier", "Game", "float", "Decomposizione oggetti a terra", { help: "Moltiplicatore del tempo che impiegano gli oggetti e le sacche di bottino lasciati a terra a scomparire dal mondo di gioco. Valori più alti li fanno rimanere più a lungo, valori più bassi li fanno sparire prima.", min: 0, max: 10, step: 0.1 }),
      f("GlobalCorpseDecompositionTimeMultiplier", "Game", "float", "Decomposizione cadaveri", { help: "Moltiplicatore del tempo che impiegano i cadaveri di creature e giocatori a scomparire dal mondo di gioco. Valori più alti li fanno rimanere più a lungo, valori più bassi li fanno sparire prima.", min: 0, max: 10, step: 0.1 }),
      f("CropGrowthSpeedMultiplier", "Game", "float", "Velocità crescita coltivazioni", { help: "Moltiplicatore della velocità di crescita delle coltivazioni piantate nelle fioriere/orti. Valori più alti fanno crescere le piante più rapidamente fino al raccolto.", min: 0, max: 10, step: 0.1 }),
      f("CropDecaySpeedMultiplier", "Game", "float", "Velocità deperimento coltivazioni", { help: "Moltiplicatore, controintuitivo, della velocità con cui le coltivazioni deperiscono se non annaffiate/concimate: valori più alti rallentano il deperimento (le piante restano sane più a lungo), valori molto bassi lo accelerano fino a far morire le piante quasi istantaneamente.", min: 0.01, max: 10, step: 0.05 }),
      f("PoopIntervalMultiplier", "Game", "float", "Intervallo produzione feci", { help: "Moltiplicatore dell'intervallo di tempo tra una produzione di feci e l'altra da parte di giocatori e creature. Valori più alti allungano l'intervallo (feci più rare); valori troppo bassi possono bloccare ripetutamente le creature nell'animazione di defecazione.", min: 0, max: 10, step: 0.1 }),
      f("FuelConsumptionIntervalMultiplier", "Game", "float", "Consumo carburante generatori", { help: "Moltiplicatore dell'intervallo di consumo del carburante in generatori e altri dispositivi alimentati a combustibile. Valori più alti allungano l'intervallo tra un consumo e l'altro, facendo durare di più il carburante.", min: 0, max: 10, step: 0.1 }),
      f("GlobalPoweredBatteryDurabilityDecreasePerSecond", "Game", "float", "Consumo batterie Tek", { help: "Quantità di durabilità/carica persa ogni secondo dalle batterie Tek mentre alimentano un dispositivo collegato (es. Tek Generator). Valori più alti fanno esaurire le batterie più rapidamente, valori più bassi le fanno durare di più.", min: 0, max: 20, step: 0.1 }),
      f("PhotoModeRangeLimit", "Game", "float", "Raggio modalità foto", { help: "Distanza massima, in unità di gioco, a cui la telecamera libera della Modalità Foto (introdotta in ARK: Survival Ascended) può allontanarsi dal personaggio prima di essere bloccata. Valori più alti permettono inquadrature più lontane dal giocatore.", min: 0, max: 20000, step: 500 }),
    ],
  },
  {
    id: "pvp",
    label: "PvP, Raid & Tribù",
    fields: [
      f("PreventOfflinePvP", "GameUserSettings", "bool", "Protezione raid offline (ORP)", { help: "Se attivo, rende invulnerabili i membri offline di una tribù e indistruttibili le loro strutture, impedendo i raid quando nessuno della tribù è connesso al server; entra in vigore dopo il ritardo definito da PreventOfflinePvPInterval." }),
      f("PreventOfflinePvPInterval", "GameUserSettings", "float", "Ritardo attivazione ORP (sec)", { help: "Numero di secondi che devono trascorrere dall'ultimo logout di tutti i membri di una tribù prima che scatti la protezione offline (ORP). Il default è 0, quindi la protezione è immediata.", min: 0, max: 7200, step: 60 }),
      f("PvPStructureDecay", "GameUserSettings", "bool", "Decadimento strutture durante ORP", { help: "Se attivo, abilita il normale decadimento nel tempo delle strutture anche in modalità PvP, che di norma ne sono esenti mentre la tribù proprietaria è protetta dall'ORP, evitando che basi abbandonate restino permanenti sulla mappa." }),
      f("PvPDinoDecay", "GameUserSettings", "bool", "Decadimento dino durante ORP", { help: "Se attivo, abilita il decadimento (e la conseguente possibilità di uccisione/reclamo) dei dinosauri appartenenti a tribù offline protette dall'ORP, che altrimenti resterebbero indefinitamente al sicuro senza necessità di essere accuditi." }),
      f("PreventTribeAlliances", "GameUserSettings", "bool", "Blocca alleanze tra tribù", { help: "Se attivo, impedisce ai giocatori di formare alleanze tra tribù diverse, obbligando ogni tribù ad agire da sola sul server, incluso ai fini della protezione ORP condivisa." }),
      f("TribeNameChangeCooldown", "GameUserSettings", "float", "Cooldown cambio nome tribù (ore)", { help: "Numero di ore che una tribù deve attendere tra un cambio di nome e il successivo, per scoraggiare cambi frequenti usati per confondere i nemici o eludere la reputazione della tribù.", min: 0, max: 168, step: 1 }),
      f("TribeLogDestroyedEnemyStructures", "GameUserSettings", "bool", "Log distruzione strutture nemiche", { help: "Se attivo, registra nel tribe log ogni struttura nemica distrutta dai membri della tribù (con dettagli su tipo e responsabile); utile per monitorare i raid ma può generare log molto lunghi su server affollati." }),
      f("UseFjordurTraversalBuff", "GameUserSettings", "bool", "Buff teletrasporto biomi Fjordur", { help: "Se attivo, consente ai giocatori di teletrasportarsi rapidamente tra i vari regni/biomi della mappa Fjordur tenendo premuto il tasto di interazione, senza dover raggiungere fisicamente gli anelli portale standard." }),
    ],
  },
  {
    id: "cryo",
    label: "Cryopod",
    fields: [
      f("EnableCryopodNerf", "GameUserSettings", "bool", "Abilita nerf cryopod", { help: "Se attivo, applica un malus temporaneo (danno inflitto ridotto e danno subito aumentato) alle creature appena rilasciate da un cryopod, per scoraggiare l'uso dei cryopod come scudo instantaneo in combattimento." }),
      f("CryopodNerfDuration", "GameUserSettings", "float", "Durata malus cryosickness (sec)", { help: "Durata in secondi del malus di cryosickness applicato a una creatura subito dopo essere stata rilasciata da un cryopod, durante il quale restano attivi i moltiplicatori di danno definiti da CryopodNerfDamageMult e CryopodNerfIncomingDamageMultPercent.", min: 0, max: 300, step: 5 }),
      f("CryopodNerfDamageMult", "GameUserSettings", "float", "Riduzione danno post-rilascio", { help: "Moltiplicatore applicato al danno inflitto dalla creatura appena rilasciata dal cryopod durante il periodo di nerf: ad esempio 0.1 significa che la creatura infligge solo il 10% del danno normale.", min: 0, max: 1, step: 0.01 }),
      f("CryopodNerfIncomingDamageMultPercent", "GameUserSettings", "float", "Aumento danno subito post-rilascio", { help: "Percentuale aggiuntiva di danno subito dalla creatura appena rilasciata dal cryopod durante il periodo di nerf: ad esempio 0.25 significa che la creatura subisce il 25% di danno in più del normale.", min: 0, max: 10, step: 0.1 }),
      f("EnableCryoSicknessPVE", "GameUserSettings", "bool", "Cryosickness attiva anche in PvE", { help: "Se attivo, estende anche alle mappe/server in modalità PvE il malus di cryosickness sulle creature rilasciate da un cryopod, che di default si applica solo in PvP." }),
    ],
  },
  {
    id: "transfer",
    label: "Trasferimenti & Tributo",
    fields: [
      f("noTributeDownloads", "GameUserSettings", "bool", "Blocca download da tributo", { help: "Se attivo, blocca completamente ogni tipo di download dal tributo (dinosauri, oggetti e sopravvissuti) verso questo server, agendo come interruttore generale indipendente dalle impostazioni granulari PreventDownload*." }),
      f("PreventDownloadDinos", "GameUserSettings", "bool", "Blocca download dino", { help: "Se attivo, impedisce di scaricare dinosauri dal tributo/obelisco su questo server, bloccando quindi l'arrivo di creature trasferite da altre mappe o server del cluster." }),
      f("PreventDownloadItems", "GameUserSettings", "bool", "Blocca download oggetti", { help: "Se attivo, impedisce di scaricare oggetti dal tributo/obelisco su questo server, bloccando quindi l'arrivo di inventari trasferiti da altre mappe o server del cluster." }),
      f("PreventDownloadSurvivors", "GameUserSettings", "bool", "Blocca download sopravvissuti", { help: "Se attivo, impedisce di scaricare personaggi/sopravvissuti dal tributo su questo server, bloccando quindi l'ingresso di personaggi trasferiti da altre mappe o server del cluster." }),
      f("PreventUploadDinos", "GameUserSettings", "bool", "Blocca upload dino", { help: "Se attivo, impedisce ai giocatori di caricare dinosauri nel tributo da questo server, bloccando quindi l'invio di creature verso altre mappe o server del cluster." }),
      f("PreventUploadItems", "GameUserSettings", "bool", "Blocca upload oggetti", { help: "Se attivo, impedisce ai giocatori di caricare oggetti nel tributo da questo server, bloccando quindi l'invio di inventari verso altre mappe o server del cluster." }),
      f("PreventUploadSurvivors", "GameUserSettings", "bool", "Blocca upload sopravvissuti", { help: "Se attivo, impedisce ai giocatori di caricare personaggi/sopravvissuti nel tributo da questo server, bloccando quindi il trasferimento del personaggio verso altre mappe o server del cluster." }),
      f("CrossARKAllowForeignDinoDownloads", "GameUserSettings", "bool", "Consenti dino non nativi da altre mappe", { help: "Se attivo, consente di scaricare su questa mappa dinosauri che normalmente non sono nativi di essa (ad esempio specie non presenti su Aberration), permettendo trasferimenti cross-map altrimenti bloccati dal gioco." }),
      f("MinimumDinoReuploadInterval", "GameUserSettings", "float", "Intervallo minimo tra upload dino (sec)", { help: "Tempo minimo in secondi che un dinosauro deve attendere dopo essere stato scaricato prima di poter essere nuovamente caricato nel tributo, usato per prevenire exploit di duplicazione tramite trasferimenti ripetuti.", min: 0, max: 86400, step: 60 }),
      f("MaxTributeCharacters", "GameUserSettings", "int", "Slot upload personaggi", { help: "Numero massimo di slot personaggio disponibili contemporaneamente nell'inventario di tributo di un giocatore, oltre il quale non è più possibile caricare altri personaggi finché non vengono ritirati.", min: 0, max: 200, step: 5 }),
      f("MaxTributeDinos", "GameUserSettings", "int", "Slot upload dino", { help: "Numero massimo di slot dinosauro disponibili contemporaneamente nell'inventario di tributo di un giocatore, oltre il quale non è più possibile caricare altre creature finché non vengono ritirate.", min: 0, max: 200, step: 5 }),
      f("MaxTributeItems", "GameUserSettings", "int", "Slot upload oggetti", { help: "Numero massimo di slot oggetto disponibili contemporaneamente nell'inventario di tributo di un giocatore, oltre il quale non è più possibile caricare altri oggetti finché non vengono ritirati.", min: 0, max: 200, step: 5 }),
      f("TributeCharacterExpirationSeconds", "GameUserSettings", "int", "Scadenza upload personaggi (sec)", { help: "Tempo in secondi entro cui un personaggio caricato nel tributo deve essere ritirato prima di essere eliminato automaticamente; il default 0 disabilita la scadenza.", min: 0, max: 604800, step: 3600 }),
      f("TributeDinoExpirationSeconds", "GameUserSettings", "int", "Scadenza upload dino (sec)", { help: "Tempo in secondi entro cui un dinosauro caricato nel tributo deve essere ritirato prima di essere eliminato automaticamente; il default di gioco è 86400 secondi (24 ore).", min: 0, max: 604800, step: 3600 }),
      f("TributeItemExpirationSeconds", "GameUserSettings", "int", "Scadenza upload oggetti (sec)", { help: "Tempo in secondi entro cui un oggetto caricato nel tributo deve essere ritirato prima di essere eliminato automaticamente; il default di gioco è 86400 secondi (24 ore).", min: 0, max: 604800, step: 3600 }),
    ],
  },
  {
    id: "chat",
    label: "Chat, HUD & Filtri",
    fields: [
      f("bFilterChat", "GameUserSettings", "bool", "Filtra parolacce in chat", { help: "Se attivo, applica un filtro automatico ai messaggi di chat in-game, censurando le parole considerate volgari o offensive in base alla lista predefinita del gioco o a quella indicata in BadWordListURL." }),
      f("bFilterCharacterNames", "GameUserSettings", "bool", "Filtra parolacce nei nomi personaggio", { help: "Se attivo, applica lo stesso filtro di parole vietate ai nomi scelti dai giocatori per i propri personaggi, impedendo o censurando nomi che contengono termini offensivi." }),
      f("bFilterTribeNames", "GameUserSettings", "bool", "Filtra parolacce nei nomi tribù", { help: "Se attivo, applica il filtro di parole vietate ai nomi delle tribù, impedendo o censurando nomi di tribù che contengono termini offensivi." }),
      f("BadWordListURL", "GameUserSettings", "string", "URL lista parole vietate", { format: "url", help: "URL di un file di testo esterno (una parola vietata per riga) che sostituisce o integra la lista predefinita di parole censurate usata dai filtri di chat e nomi." }),
      f("BadWordWhiteListURL", "GameUserSettings", "string", "URL lista parole consentite", { format: "url", help: "URL di un file di testo esterno con parole esplicitamente escluse dal filtro (whitelist), utile per evitare falsi positivi su termini legittimi che contengono sottostringhe censurate." }),
    ],
  },
  {
    id: "admin",
    label: "Amministrazione avanzata",
    fields: [
      f("CustomDynamicConfigUrl", "GameUserSettings", "string", "URL configurazione dinamica", { format: "url", help: "URL da cui il server scarica periodicamente un file dynamicconfig.ini con impostazioni di gioco aggiornabili a runtime senza riavviare il server; richiede il flag di avvio -UseDynamicConfig per essere effettivo." }),
      f("CustomLiveTuningUrl", "GameUserSettings", "string", "URL live tuning decadimento", { format: "url", help: "URL da cui il server scarica un file di live tuning usato per modificare a runtime parametri come i tassi di decadimento delle strutture (decay), senza necessità di riavviare il server." }),
      f("NPCNetworkStasisRangeScalePlayerCountStart", "GameUserSettings", "int", "Stasi NPC: giocatori (inizio scala)", { help: "Numero di giocatori online a partire dal quale il server inizia a ridurre il raggio entro cui le creature NPC restano attive in rete (fuori stasi), per alleggerire il carico quando ci sono molti giocatori connessi.", min: 0, max: 200, step: 1 }),
      f("NPCNetworkStasisRangeScalePlayerCountEnd", "GameUserSettings", "int", "Stasi NPC: giocatori (fine scala)", { help: "Numero di giocatori online oltre il quale la riduzione del raggio di attività di rete delle creature NPC raggiunge il suo valore massimo, definito da NPCNetworkStasisRangeScalePercentEnd.", min: 0, max: 200, step: 1 }),
      f("NPCNetworkStasisRangeScalePercentEnd", "GameUserSettings", "float", "Stasi NPC: percentuale massima", { help: "Percentuale minima a cui puo' essere ridotto il raggio di rete delle creature NPC quando il numero di giocatori raggiunge NPCNetworkStasisRangeScalePlayerCountEnd, ad esempio 0.5 significa ridotto al 50%.", min: 0, max: 1, step: 0.01 }),
    ],
  },
  {
    id: "rules-extra",
    label: "Regole di gioco complete",
    fields: [
      f("bUseSingleplayerSettings", "Game", "bool", "Applica moltiplicatori single-player", { help: "Applica il pacchetto di bonus single-player sopra ai valori configurati; modifica molti tassi e statistiche contemporaneamente." }),
      f("bAllowUnlimitedRespecs", "Game", "bool", "Respec illimitati"),
      f("bAllowSpeedLeveling", "Game", "bool", "Consenti punti in velocità movimento"),
      f("bAllowFlyerSpeedLeveling", "Game", "bool", "Consenti punti velocità ai volanti"),
      f("bAllowUnclaimDinos", "Game", "bool", "Consenti abbandono dino"),
      f("bAllowCustomRecipes", "Game", "bool", "Consenti ricette personalizzate"),
      f("bAllowPlatformSaddleMultiFloors", "Game", "bool", "Più piani sulle selle piattaforma"),
      f("bDisableDinoBreeding", "Game", "bool", "Disabilita allevamento dino"),
      f("bDisableDinoRiding", "Game", "bool", "Disabilita cavalcatura dino"),
      f("bDisableDinoTaming", "Game", "bool", "Disabilita addomesticamento"),
      f("bDisableLootCrates", "Game", "bool", "Disabilita supply crate"),
      f("bDisablePhotoMode", "Game", "bool", "Disabilita modalità foto"),
      f("bShowCreativeMode", "Game", "bool", "Mostra modalità creativa"),
      f("bUseCorpseLocator", "Game", "bool", "Localizzatore cadavere"),
      f("bUseDinoLevelUpAnimations", "Game", "bool", "Animazione livello dino"),
      f("bAutoPvETimer", "Game", "bool", "Alterna automaticamente PvE/PvP"),
      f("bAutoPvEUseSystemTime", "Game", "bool", "Timer PvE/PvP usa ora reale"),
      f("AutoPvEStartTimeSeconds", "Game", "float", "Inizio finestra PvE (secondi dal giorno)", { min: 0, max: 86400, step: 60 }),
      f("AutoPvEStopTimeSeconds", "Game", "float", "Fine finestra PvE (secondi dal giorno)", { min: 0, max: 86400, step: 60 }),
      f("bAutoUnlockAllEngrams", "Game", "bool", "Sblocca automaticamente tutti gli engrammi"),
      f("bOnlyAllowSpecifiedEngrams", "Game", "bool", "Consenti solo engrammi specificati"),
      f("bUseTameLimitForStructuresOnly", "Game", "bool", "Limite tame usato solo per strutture su sella"),
      f("OverrideMaxExperiencePointsPlayer", "Game", "int", "XP massimo giocatore", { help: "Override del tetto XP del giocatore; va coordinato con LevelExperienceRampOverrides nell'editor avanzato.", min: 0, max: 2147483647, step: 1000 }),
      f("OverrideMaxExperiencePointsDino", "Game", "int", "XP massimo dino", { help: "Override del tetto XP dei dino tame; va coordinato con LevelExperienceRampOverrides nell'editor avanzato.", min: 0, max: 2147483647, step: 1000 }),
      f("bIgnoreStructuresPreventionVolumes", "Game", "bool", "Ignora volumi anti-costruzione"),
      f("bFlyerPlatformAllowUnalignedDinoBasing", "Game", "bool", "Dino non allineati su piattaforme volanti"),
      f("BaseTemperatureMultiplier", "Game", "float", "Moltiplicatore temperatura base", { min: 0, max: 10, step: 0.1 }),
      f("MaxFallSpeedMultiplier", "Game", "float", "Moltiplicatore velocità massima di caduta", { min: 0, max: 10, step: 0.1 }),
      f("ListenServerTetherDistanceMultiplier", "GameUserSettings", "float", "Distanza tether non-dedicato", { help: "Rilevante solo per sessioni non dedicate; su questo dedicated server viene conservata ma non cambia il gameplay.", min: 0, max: 100, step: 0.05 }),
    ],
  },
  {
    id: "friendly-fire",
    label: "PvE, PvP & fuoco amico",
    fields: [
      f("bDisableFriendlyFire", "Game", "bool", "Disabilita fuoco amico PvP"),
      f("bPvEDisableFriendlyFire", "Game", "bool", "Disabilita fuoco amico PvE"),
      f("bPvEAllowTribeWar", "Game", "bool", "Consenti guerre tra tribù in PvE"),
      f("bPvEAllowTribeWarCancel", "Game", "bool", "Consenti annullamento guerra PvE"),
      f("bPassiveDefensesDamageRiderlessDinos", "Game", "bool", "Difese passive colpiscono dino senza cavaliere"),
      f("bIncreasePvPRespawnInterval", "Game", "bool", "Aumenta respawn dopo morti PvP ripetute"),
      f("IncreasePvPRespawnIntervalBaseAmount", "Game", "float", "Penalità base respawn PvP (sec)", { min: 0, max: 3600, step: 5 }),
      f("IncreasePvPRespawnIntervalCheckPeriod", "Game", "float", "Finestra morti PvP ripetute (sec)", { min: 0, max: 86400, step: 60 }),
      f("IncreasePvPRespawnIntervalMultiplier", "Game", "float", "Moltiplicatore penalità respawn PvP", { min: 0, max: 100, step: 0.1 }),
      f("PreventOfflinePvPConnectionInvincibleInterval", "Game", "float", "Invulnerabilità connessione con ORP (sec)", { min: 0, max: 3600, step: 1 }),
      f("PvPZoneStructureDamageMultiplier", "Game", "float", "Danno strutture nelle zone PvP", { min: 0, max: 100, step: 0.1 }),
      f("MaxNumberOfPlayersInTribe", "Game", "int", "Giocatori massimi per tribù", { min: 0, max: 1000, step: 1 }),
      f("MaxAlliancesPerTribe", "Game", "int", "Alleanze massime per tribù", { min: 0, max: 100, step: 1 }),
      f("MaxTribesPerAlliance", "Game", "int", "Tribù massime per alleanza", { min: 0, max: 100, step: 1 }),
      f("TribeSlotReuseCooldown", "Game", "float", "Cooldown riuso slot tribù (sec)", { min: 0, max: 604800, step: 60 }),
      f("MaxTribeLogs", "Game", "int", "Righe massime tribe log", { min: 0, max: 10000, step: 50 }),
      f("TribeMergeAllowed", "GameUserSettings", "bool", "Consenti fusione tribù"),
      f("TribeMergeCooldown", "GameUserSettings", "float", "Cooldown fusione tribù (sec)", { min: 0, max: 604800, step: 60 }),
      f("PreventOutOfTribePinCodeUse", "GameUserSettings", "bool", "Blocca PIN a giocatori fuori tribù"),
    ],
  },
  {
    id: "harvest-loot-extra",
    label: "Raccolta, loot & oggetti",
    fields: [
      f("DinoHarvestingDamageMultiplier", "Game", "float", "Danno raccolta dei dino", { min: 0, max: 100, step: 0.1 }),
      f("PlayerHarvestingDamageMultiplier", "Game", "float", "Danno raccolta giocatore", { min: 0, max: 100, step: 0.1 }),
      f("SupplyCrateLootQualityMultiplier", "Game", "float", "Qualità loot supply crate", { min: 0, max: 100, step: 0.1 }),
      f("FishingLootQualityMultiplier", "Game", "float", "Qualità loot pesca", { min: 0, max: 100, step: 0.1 }),
      f("CraftingSkillBonusMultiplier", "Game", "float", "Bonus qualità da abilità crafting", { min: 0, max: 100, step: 0.1 }),
      f("PassiveTameIntervalMultiplier", "Game", "float", "Intervallo richieste tame passivo", { min: 0, max: 100, step: 0.1 }),
      f("WildDinoCharacterFoodDrainMultiplier", "Game", "float", "Consumo cibo dino selvatici", { min: 0, max: 100, step: 0.1 }),
      f("TamedDinoCharacterFoodDrainMultiplier", "Game", "float", "Consumo cibo dino tame", { min: 0, max: 100, step: 0.1 }),
      f("WildDinoTorporDrainMultiplier", "Game", "float", "Recupero torpore dino selvatici", { min: 0, max: 100, step: 0.1 }),
      f("TamedDinoTorporDrainMultiplier", "Game", "float", "Recupero torpore dino tame", { min: 0, max: 100, step: 0.1 }),
      f("UseCorpseLifeSpanMultiplier", "Game", "float", "Durata cadaveri dei giocatori", { min: 0, max: 100, step: 0.1 }),
      f("LimitNonPlayerDroppedItemsCount", "Game", "int", "Oggetti non-player massimi in area", { min: 0, max: 100000, step: 10 }),
      f("LimitNonPlayerDroppedItemsRange", "Game", "int", "Raggio limite oggetti non-player", { min: 0, max: 100000, step: 100 }),
      f("ExcludeItemIndices", "Game", "string", "Indici oggetti esclusi", { help: "Lista strutturata di indici oggetto esclusi. Per più valori o sintassi complesse usare l'editor INI avanzato." }),
      f("ResourceNoReplenishRadiusPlayers", "Game", "float", "Raggio anti-respawn risorse dai giocatori", { min: 0, max: 100, step: 0.1 }),
      f("ResourceNoReplenishRadiusStructures", "Game", "float", "Raggio anti-respawn risorse dalle strutture", { min: 0, max: 100, step: 0.1 }),
    ],
  },
  {
    id: "dino-extra",
    label: "Creature & limiti avanzati",
    fields: [
      f("AllowCryoFridgeOnSaddle", "GameUserSettings", "bool", "Consenti cryofridge sulle selle"),
      f("DisableCryopodEnemyCheck", "GameUserSettings", "bool", "Ignora nemici vicini per cryopod"),
      f("DisableCryopodFridgeRequirement", "GameUserSettings", "bool", "Cryopod senza cryofridge attivo"),
      f("DisableBurrowDecayTimers", "GameUserSettings", "bool", "Disabilita timer decadimento creature in tana"),
      f("DestroyTamesOverTheSoftTameLimit", "GameUserSettings", "bool", "Distruggi tame oltre limite morbido"),
      f("MaxTamedDinos_SoftTameLimit", "GameUserSettings", "int", "Limite morbido tame server", { min: 0, max: 100000, step: 100 }),
      f("MaxTamedDinos_SoftTameLimit_CountdownForDeletionDuration", "GameUserSettings", "int", "Countdown tame oltre limite (sec)", { min: 0, max: 2592000, step: 3600 }),
      f("DestroyTamesOverLevelClamp", "Game", "int", "Distruggi tame sopra questo livello", { min: 0, max: 10000, step: 1 }),
      f("ForceGachaUnhappyInCaves", "GameUserSettings", "bool", "Forza Gacha infelici nelle grotte"),
      f("AllowMultipleTamedUnicorns", "GameUserSettings", "bool", "Consenti più unicorni tame", { section: "Ragnarok" }),
      f("ArmadoggoDeathCooldown", "GameUserSettings", "int", "Cooldown ritorno Armadoggo (sec)", { min: 1, max: 604800, step: 60 }),
      f("YoungIceFoxDeathCooldown", "GameUserSettings", "int", "Cooldown ritorno Ice Fox (sec)", { min: 1, max: 604800, step: 60 }),
      f("MaxTrainCars", "GameUserSettings", "int", "Vagoni massimi per treno", { min: 0, max: 1000, step: 1 }),
      f("CosmoWeaponAmmoReloadAmount", "GameUserSettings", "int", "Munizioni ricaricate dal Cosmo", { min: 0, max: 1000, step: 1 }),
      f("MaxCosmoWeaponAmmo", "GameUserSettings", "int", "Munizioni massime Cosmo (-1 = scala col livello)", { min: -1, max: 100000, step: 1 }),
      f("MaxHexagonsPerCharacter", "GameUserSettings", "int", "Esagoni massimi per personaggio", { min: 0, max: 2147483647, step: 1000 }),
      f("FreezeReaperPregnancy", "GameUserSettings", "bool", "Congela gravidanza Reaper offline"),
      f("AllowTekSuitPowersInGenesis", "GameUserSettings", "bool", "Consenti poteri tuta Tek in Genesis"),
    ],
  },
  {
    id: "structures-extra",
    label: "Strutture, torrette & generatori",
    fields: [
      f("bDisableWirelessCrafting", "Game", "bool", "Disabilita crafting wireless globale"),
      f("bDisableWirelessCraftingForDinos", "Game", "bool", "Disabilita crafting wireless dai dino"),
      f("bDisableWirelessCraftingForPlayers", "Game", "bool", "Disabilita crafting wireless dai giocatori"),
      f("bDisableWirelessCraftingForStructures", "Game", "bool", "Disabilita crafting wireless dalle strutture"),
      f("WirelessCraftingRangeOverride", "Game", "float", "Raggio crafting wireless", { min: 0, max: 100000, step: 100 }),
      f("StructureDamageRepairCooldown", "Game", "int", "Cooldown riparazione dopo danno (sec)", { min: 0, max: 86400, step: 5 }),
      f("FastDecayInterval", "Game", "int", "Decadimento rapido strutture isolate (sec)", { min: 0, max: 2592000, step: 3600 }),
      f("LimitGeneratorsNum", "Game", "int", "Generatori massimi in un'area", { min: 0, max: 10000, step: 1 }),
      f("LimitGeneratorsRange", "Game", "int", "Raggio limite generatori", { min: 0, max: 100000, step: 100 }),
      f("bLimitTurretsInRange", "Game", "bool", "Limita torrette per area"),
      f("bHardLimitTurretsInRange", "Game", "bool", "Limite rigido torrette per area"),
      f("LimitTurretsNum", "Game", "int", "Torrette massime in un'area", { min: 0, max: 10000, step: 1 }),
      f("LimitTurretsRange", "Game", "float", "Raggio limite torrette", { min: 0, max: 100000, step: 100 }),
      f("DinoTurretDamageMultiplier", "Game", "float", "Danno torrette contro dino", { min: 0, max: 100, step: 0.1 }),
      f("IgnorePVPMountedWeaponryRestrictions", "Game", "bool", "Ignora restrizioni armi montate PvP"),
      f("IgnoreLimitMaxStructuresInRangeTypeFlag", "GameUserSettings", "bool", "Ignora tipo nel limite strutture per area"),
      f("MaxStructuresInSmallRadius", "GameUserSettings", "int", "Strutture massime nel raggio piccolo", { min: 0, max: 100000, step: 100 }),
      f("RadiusStructuresInSmallRadius", "GameUserSettings", "float", "Raggio piccolo limite strutture", { min: 0, max: 100000, step: 100 }),
      f("MaxStructuresToProcess", "GameUserSettings", "int", "Strutture massime elaborate per ciclo", { min: 0, max: 100000, step: 100 }),
      f("TribeTowerBonusMultiplier", "Game", "float", "Bonus torre tribù", { min: 0, max: 100, step: 0.1 }),
    ],
  },
  {
    id: "asa-map-features",
    label: "Contenuti ASA & mappe",
    fields: [
      f("AdjustableMutagenSpawnDelayMultiplier", "Game", "float", "Intervallo spawn Mutagene", { min: 0, max: 100, step: 0.1 }),
      f("BaseHexagonRewardMultiplier", "Game", "float", "Ricompensa base esagoni", { min: 0, max: 100, step: 0.1 }),
      f("HexagonCostMultiplier", "Game", "float", "Costo negozio esagoni", { min: 0, max: 100, step: 0.1 }),
      f("bDisableHexagonStore", "Game", "bool", "Disabilita negozio esagoni"),
      f("bDisableDefaultMapItemSets", "Game", "bool", "Disabilita set oggetti predefiniti mappa"),
      f("bDisableGenesisMissions", "Game", "bool", "Disabilita missioni Genesis"),
      f("bDisableWorldBuffs", "Game", "bool", "Disabilita buff mondo"),
      f("bEnableWorldBuffScaling", "Game", "bool", "Scala buff mondo"),
      f("WorldBuffScalingEfficacy", "Game", "float", "Efficacia scala buff mondo", { min: 0, max: 100, step: 0.1 }),
      f("bGenesisUseStructuresPreventionVolumes", "Game", "bool", "Volumi anti-costruzione Genesis"),
      f("bHexStoreAllowOnlyEngramTradeOption", "Game", "bool", "Negozio esagoni: solo engrammi"),
      f("EnableVolcano", "GameUserSettings", "bool", "Abilita vulcano Ragnarok", { section: "Ragnarok" }),
      f("VolcanoIntensity", "GameUserSettings", "float", "Intensità vulcano Ragnarok", { section: "Ragnarok", min: 0.25, max: 10, step: 0.05 }),
      f("VolcanoInterval", "GameUserSettings", "float", "Intervallo vulcano Ragnarok", { section: "Ragnarok", min: 0, max: 1000000, step: 60 }),
      f("UnicornSpawnInterval", "GameUserSettings", "int", "Intervallo spawn unicorno Ragnarok (ore)", { section: "Ragnarok", min: 0, max: 8760, step: 1 }),
      f("ValgueroMemorialEntries", "Game", "string", "Voci memoriale Valguero", { help: "Direttiva specifica di Valguero; per valori multipli/strutturati usare l'editor avanzato." }),
    ],
  },
  {
    id: "lost-colony",
    label: "Lost Colony",
    fields: [
      f("LimitBunkersPerTribe", "GameUserSettings", "bool", "Limita bunker per tribù"),
      f("LimitBunkersPerTribeNum", "GameUserSettings", "int", "Bunker massimi per tribù", { min: 0, max: 1000, step: 1 }),
      f("AllowBunkersInPreventionZones", "GameUserSettings", "bool", "Bunker nelle zone protette"),
      f("AllowRidingDinosInsideBunkers", "GameUserSettings", "bool", "Cavalca dino nei bunker"),
      f("AllowBunkerModulesAboveGround", "GameUserSettings", "bool", "Moduli bunker fuori terra"),
      f("AllowDinoAIInsideBunkers", "GameUserSettings", "bool", "IA dino dentro i bunker"),
      f("AllowBunkerModulesInPreventionZones", "GameUserSettings", "bool", "Moduli bunker nelle zone protette"),
      f("MinDistanceBetweenBunkers", "GameUserSettings", "float", "Distanza minima tra bunker", { min: 0, max: 100000, step: 100 }),
      f("EnemyAccessBunkerHPThreshold", "GameUserSettings", "float", "Soglia salute accesso nemico bunker", { min: 0, max: 1, step: 0.01 }),
      f("BunkerUnderHPThresholdDmgMultiplier", "GameUserSettings", "float", "Danno sotto soglia salute bunker", { min: 0, max: 100, step: 0.01 }),
      f("CryoHospitalHoursToRegenHP", "GameUserSettings", "float", "Ore Cryo Hospital per rigenerare salute", { min: 0, max: 1000, step: 0.1 }),
      f("CryoHospitalHoursToRegenFood", "GameUserSettings", "float", "Ore Cryo Hospital per rigenerare cibo", { min: 0, max: 1000, step: 0.1 }),
      f("CryoHospitalHoursToDrainTorpor", "GameUserSettings", "float", "Ore Cryo Hospital per azzerare torpore", { min: 0, max: 1000, step: 0.1 }),
      f("CryoHospitalMatingCooldownReduction", "GameUserSettings", "float", "Riduzione cooldown accoppiamento Cryo Hospital", { min: 0, max: 100, step: 0.1 }),
      f("BloodforgeReinforceExtraDurability", "GameUserSettings", "float", "Durabilità extra rinforzo Bloodforge", { min: 0, max: 100, step: 0.01 }),
      f("BloodforgeReinforceResourceCostMultiplier", "GameUserSettings", "float", "Costo rinforzo Bloodforge", { min: 0, max: 100, step: 0.1 }),
      f("BloodforgeReinforceSpeedMultiplier", "GameUserSettings", "float", "Velocità rinforzo Bloodforge", { min: 0, max: 100, step: 0.01 }),
      f("MaxActiveOutposts", "GameUserSettings", "int", "Avamposti attivi massimi", { min: 0, max: 10000, step: 1 }),
      f("MaxActiveResourceCaches", "GameUserSettings", "int", "Cache risorse attive massime", { min: 0, max: 10000, step: 1 }),
      f("MaxActiveCityOutposts", "GameUserSettings", "int", "Avamposti città attivi massimi", { min: 0, max: 10000, step: 1 }),
      f("OutpostSigilRewardMultiplier", "GameUserSettings", "float", "Ricompensa sigilli avamposto", { min: 0, max: 100, step: 0.1 }),
    ],
  },
  {
    id: "logging-security",
    label: "Log, accesso & sicurezza",
    fields: [
      f("AllowHideDamageSourceFromLogs", "GameUserSettings", "bool", "Consenti di nascondere fonte danno nei log"),
      f("AlwaysNotifyPlayerLeft", "GameUserSettings", "bool", "Notifica sempre uscita giocatori"),
      f("DontAlwaysNotifyPlayerJoined", "GameUserSettings", "bool", "Non notificare sempre ingresso giocatori"),
      f("LogChatMessages", "GameUserSettings", "bool", "Salva chat su file"),
      f("ChatLogFileSplitIntervalSeconds", "GameUserSettings", "int", "Rotazione file chat (sec)", { min: 0, max: 2592000, step: 60 }),
      f("ChatLogFlushIntervalSeconds", "GameUserSettings", "int", "Flush log chat (sec)", { min: 0, max: 2592000, step: 15 }),
      f("ChatLogMaxAgeInDays", "GameUserSettings", "int", "Conservazione log chat (giorni)", { min: -1, max: 3650, step: 1 }),
      f("AdminListURL", "GameUserSettings", "string", "URL lista amministratori", {
        help: "Gestito dall'infrastruttura: ASA legge la whitelist della PWA da un endpoint locale dell'agent, anonimo soltanto sul loopback.",
        infrastructureManaged: true,
      }),
      f("UpdateAllowedCheatersInterval", "GameUserSettings", "int", "Aggiornamento lista admin (sec)", {
        help: "Gestito dall'infrastruttura: la lista locale viene riletta ogni 5 secondi senza riavviare ASA.",
        infrastructureManaged: true,
        min: 3,
        max: 2592000,
        step: 1,
      }),
      f("UseCharacterTracker", "GameUserSettings", "bool", "Tracciamento personaggi"),
      f("UseExclusiveList", "GameUserSettings", "bool", "Whitelist esclusiva"),
      f("AllowSharedConnections", "GameUserSettings", "bool", "Consenti connessioni condivise"),
      f("ServerEnableMeshChecking", "GameUserSettings", "bool", "Controllo anti-mesh server"),
      f("EnableMeshBitingProtection", "GameUserSettings", "bool", "Protezione morsi attraverso mesh"),
      f("DontRestoreBackup", "GameUserSettings", "bool", "Non ripristinare backup su save corrotto"),
      f("EnableAFKKickPlayerCountPercent", "GameUserSettings", "float", "Soglia giocatori per kick AFK", { min: 0, max: 1, step: 0.01 }),
      f("CosmeticWhitelistOverride", "GameUserSettings", "string", "Override whitelist cosmetici"),
      f("AutoRestartIntervalSeconds", "GameUserSettings", "float", "Arresto automatico processo ASA (sec)", { help: "Opzione ASA non documentata: non esegue un riavvio affidabile e può limitarsi a chiudere il processo. Lasciare vuoto nel normale uso on-demand.", min: 0, max: 2592000, step: 60 }),
      f("Message", "GameUserSettings", "string", "Messaggio del giorno", { section: "MessageOfTheDay" }),
      f("Duration", "GameUserSettings", "int", "Durata messaggio del giorno (sec)", { section: "MessageOfTheDay", min: 0, max: 600, step: 1 }),
    ],
  },
  {
    id: "launch-options",
    label: "Opzioni di avvio ASA",
    fields: [
      f("EnableIdlePlayerKick", "GameUserSettings", "bool", "Attiva kick giocatori inattivi", { section: "ARKSA.Launch", help: "Aggiunge -EnableIdlePlayerKick; la durata è KickIdlePlayersPeriod." }),
      f("AutoDestroyStructures", "GameUserSettings", "bool", "Attiva auto-distruzione strutture", { section: "ARKSA.Launch", help: "Aggiunge -AutoDestroyStructures; il tempo è regolato da AutoDestroyOldStructuresMultiplier." }),
      f("ForceAllowCaveFlyers", "GameUserSettings", "bool", "Consenti volanti nelle grotte", { section: "ARKSA.Launch" }),
      f("NoDinos", "GameUserSettings", "bool", "Avvia senza creature", { section: "ARKSA.Launch" }),
      f("NoWildBabies", "GameUserSettings", "bool", "Disabilita cuccioli selvatici", { section: "ARKSA.Launch" }),
      f("ExclusiveJoin", "GameUserSettings", "bool", "Solo whitelist esclusiva", { section: "ARKSA.Launch", legacy: true }),
      f("UseDynamicConfig", "GameUserSettings", "bool", "Abilita configurazione dinamica", { section: "ARKSA.Launch", help: "Aggiunge -UseDynamicConfig; impostare anche CustomDynamicConfigUrl." }),
      f("ServerGameLog", "GameUserSettings", "bool", "Abilita game log server", { section: "ARKSA.Launch" }),
      f("ServerGameLogIncludeTribeLogs", "GameUserSettings", "bool", "Includi tribe log nel game log", { section: "ARKSA.Launch" }),
      f("NoTransferFromFiltering", "GameUserSettings", "bool", "Ignora filtri trasferimento", { section: "ARKSA.Launch", help: "Se attivo aggiunge -NoTransferFromFiltering e consente trasferimenti senza applicare i filtri PreventDownload/Upload. Non è più forzato dal launcher." }),
      f("ServerPlatform", "GameUserSettings", "string", "Piattaforme ammesse", { section: "ARKSA.Launch", choices: SERVER_PLATFORM_CHOICES, help: "Piattaforme che possono entrare (-ServerPlatform). ALL le ammette tutte; una combinazione sbagliata rende il server invisibile ai giocatori esclusi." }),
      f("ClusterId", "GameUserSettings", "string", "ID cluster", { section: "ARKSA.Launch" }),
      f("ClusterDirOverride", "GameUserSettings", "string", "Directory cluster condivisa", { section: "ARKSA.Launch" }),
    ],
  },
  {
    id: "stats-per-level",
    label: "Statistiche per livello & Mutagene",
    fields: indexedStatFields,
  },
];

/** Categorie finali dell'editor, ricomposte senza alterare le 422 definizioni INI. */
export const GAME_SETTINGS: GameSettingCategory[] = organizeGameSettings(SOURCE_GAME_SETTINGS);

export const ALL_GAME_SETTING_FIELDS: GameSettingField[] = GAME_SETTINGS.flatMap((c) => c.fields);
