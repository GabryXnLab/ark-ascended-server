// Regole di validazione delle impostazioni di gioco, condivise da PWA, backend
// e server-agent. Questo file è la sorgente unica (modulo puro, senza import);
// le copie in control-plane/backend/src/shared e server-agent/src/shared sono
// generate da scripts/sync-config-rules.ts e verificate dai test dell'agent.
// Non modificare le copie a mano.

export type IniFile = "GameUserSettings" | "Game";

export interface IniOverrideSet {
  values: Record<string, string>;
  sections: Record<string, string>;
  raw?: string;
  managedKeys?: string[];
}

/** Sottoinsieme del catalogo PWA necessario a validare tipi, intervalli e posizione delle chiavi. */
export interface CatalogRule {
  key: string;
  file: IniFile;
  label: string;
  section?: string;
  type: "bool" | "float" | "int" | "string" | "password";
  min?: number;
  max?: number;
  infrastructureManaged?: boolean;
  /** Valori ammessi (select): qualunque altro è rifiutato. */
  choices?: readonly { value: string }[];
  /** "url": indirizzo http(s) senza spazi, eventualmente già fra virgolette. */
  format?: "url";
  /** L'agent scrive il valore fra virgolette doppie (es. BanListURL). */
  quoted?: boolean;
}

// Sezione dove finiscono le chiavi note e le direttive raw prive di header.
export const DEFAULT_SECTION: Record<IniFile, string> = {
  GameUserSettings: "ServerSettings",
  Game: "/script/shootergame.shootergamemode",
};

export const MANAGED_BEGIN = "; BEGIN ARKSA MANAGED CONFIG";
export const MANAGED_END = "; END ARKSA MANAGED CONFIG";

// Chiavi di GameUserSettings.ini possedute dall'infrastruttura (launcher, agent e
// control plane le leggono da env): i profili non possono impostarle. RCONPort
// è qui perché una porta diversa da quella dell'env spezzerebbe health, saveworld
// e auto-stop, o andrebbe in collisione con le porte di gioco e dell'agent.
export const INFRASTRUCTURE_MANAGED_GUS_KEY_NAMES = [
  "ServerAdminPassword",
  "AdminListURL",
  "UpdateAllowedCheatersInterval",
  "RCONPort",
] as const;

const INFRASTRUCTURE_MANAGED_GUS_KEYS = new Set(INFRASTRUCTURE_MANAGED_GUS_KEY_NAMES.map((key) => key.toLowerCase()));

export function isInfrastructureManagedGusKey(key: string): boolean {
  return INFRASTRUCTURE_MANAGED_GUS_KEYS.has(key.replace(/^[+-]/, "").toLowerCase());
}

// Chiavi di profili storici che il launcher impone comunque (?RCONEnabled=True
// sull'URL di avvio: l'agent ha sempre bisogno di RCON). Il salvataggio le accetta
// per non bloccare quei profili, l'agent le scarta prima di scrivere l'INI.
export const OBSOLETE_INFRASTRUCTURE_GUS_KEY_NAMES = ["RCONEnabled"] as const;

const OBSOLETE_INFRASTRUCTURE_GUS_KEYS = new Set(OBSOLETE_INFRASTRUCTURE_GUS_KEY_NAMES.map((key) => key.toLowerCase()));

export function isObsoleteInfrastructureGusKey(key: string): boolean {
  return OBSOLETE_INFRASTRUCTURE_GUS_KEYS.has(key.toLowerCase());
}

/**
 * Sezioni in cui profili salvati con un catalogo precedente hanno ancora una
 * chiave: MaxPlayers stava in [/Script/Engine.GameSession], che ASA ignora e dove
 * ASA stesso scrive il proprio valore; il launcher la legge solo da [ARKSA.Launch].
 */
export const LEGACY_KEY_SECTIONS: Readonly<Record<string, { file: IniFile; sections: readonly string[]; section: string }>> = {
  maxplayers: { file: "GameUserSettings", sections: ["/Script/Engine.GameSession"], section: "ARKSA.Launch" },
};

function isLegacySection(file: IniFile, key: string, section: string): boolean {
  const legacy = LEGACY_KEY_SECTIONS[key.toLowerCase()];
  return legacy?.file === file && legacy.sections.some((candidate) => sameText(candidate, section));
}

/**
 * Chiavi spostate di file dal catalogo: i profili salvati prima dello
 * spostamento le hanno ancora nel file vecchio e l'agent le migra al volo.
 */
export const LEGACY_KEY_LOCATIONS: Readonly<Record<string, { key: string; legacyFile: IniFile; file: IniFile }>> = {
  implantsuicidecd: { key: "ImplantSuicideCD", legacyFile: "Game", file: "GameUserSettings" },
  ignorepvpmountedweaponryrestrictions: {
    key: "IgnorePVPMountedWeaponryRestrictions",
    legacyFile: "GameUserSettings",
    file: "Game",
  },
};

/**
 * Sposta nel file e nella sezione corretti le chiavi salvate prima della
 * correzione del catalogo (valore, sezione e managedKeys) e scarta le chiavi
 * obsolete imposte dal launcher. Non tocca i set già corretti e non
 * sovrascrive un valore presente nel file di destinazione.
 */
export function migrateLegacyKeyLocations(sets: Record<IniFile, IniOverrideSet>): Record<IniFile, IniOverrideSet> {
  const next: Record<IniFile, IniOverrideSet> = {
    GameUserSettings: structuredClone(sets.GameUserSettings),
    Game: structuredClone(sets.Game),
  };
  for (const moved of Object.values(LEGACY_KEY_LOCATIONS)) {
    const from = next[moved.legacyFile];
    const to = next[moved.file];
    if (from.values[moved.key] !== undefined && to.values[moved.key] === undefined) {
      to.values[moved.key] = from.values[moved.key] as string;
    }
    delete from.values[moved.key];
    delete from.sections[moved.key];
    if (from.managedKeys?.includes(moved.key)) {
      from.managedKeys = from.managedKeys.filter((key) => key !== moved.key);
      to.managedKeys = [...new Set([...(to.managedKeys ?? []), moved.key])];
    }
  }
  for (const file of ["GameUserSettings", "Game"] as const) {
    const set = next[file];
    for (const [key, section] of Object.entries(set.sections)) {
      if (isLegacySection(file, key, section)) set.sections[key] = LEGACY_KEY_SECTIONS[key.toLowerCase()]!.section;
    }
  }
  for (const key of Object.keys(next.GameUserSettings.values)) {
    if (!isObsoleteInfrastructureGusKey(key)) continue;
    delete next.GameUserSettings.values[key];
    delete next.GameUserSettings.sections[key];
  }
  return next;
}

export function keyFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#") || trimmed.startsWith("[")) return null;
  const equals = trimmed.indexOf("=");
  if (equals <= 0) return null;
  const key = trimmed.slice(0, equals).trim();
  // Accetta anche le chiavi strutturate di ARK (es. Foo[7]) ma non testo
  // arbitrario/spaziato che non può essere una direttiva INI.
  // Unreal accetta anche operatori array (+Key/-Key) e proprietà di mod con
  // namespace puntato. Registrarli nel sidecar è necessario perché ASA può
  // rimuovere i commenti-marker da GameUserSettings.ini durante lo shutdown.
  return /^[+-]?[A-Za-z0-9_.:-]+(?:\[[^\]\r\n]+\])?$/.test(key) ? key : null;
}

export interface RawDirective {
  section: string;
  key: string;
}

/**
 * Scompone l'editor avanzato assegnando a ogni chiave la sezione effettiva:
 * le righe prima del primo header appartengono alla sezione predefinita del file.
 */
export function parseRawDirectives(
  file: IniFile,
  raw: string | undefined,
): { directives: RawDirective[]; errors: string[]; markerError: string | null } {
  const directives: RawDirective[] = [];
  const errors: string[] = [];
  if (!raw?.trim()) return { directives, errors, markerError: null };
  if (raw.includes(MANAGED_BEGIN) || raw.includes(MANAGED_END)) {
    return { directives, errors, markerError: "Le direttive avanzate non possono contenere i marker interni ARKSA" };
  }
  let section = DEFAULT_SECTION[file];
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      const header = trimmed.match(/^\[([^[\]\r\n]+)\]$/);
      if (header?.[1]) section = header[1];
      else errors.push(`Intestazione di sezione non valida nelle direttive avanzate: ${trimmed.slice(0, 80)}`);
      continue;
    }
    const key = keyFromLine(line);
    if (key) directives.push({ section, key });
    else errors.push(`Riga non valida nelle direttive avanzate (atteso Chiave=Valore): ${trimmed.slice(0, 80)}`);
  }
  return { directives, errors, markerError: null };
}

// Argomenti già generati dal launcher o posseduti da un campo dedicato: ammetterli
// produrrebbe override ambigui, porte in collisione o credenziali sostituite.
export const RESERVED_LAUNCH_ARGS: readonly string[] = [
  "mods", "winlivemaxplayers", "serverplatform", "clusterid", "clusterdiroverride",
  "port", "ip", "serverip", "notransferfromfiltering", "enableidleplayerkick",
  "autodestroystructures", "forceallowcaveflyers", "nodinos", "nowildbabies",
  "exclusivejoin", "usedynamicconfig", "servergamelog", "servergamelogincludetribelogs",
  "multihome", "nosound", "usestore", "newsaveformat",
  // Parametri dell'URL di avvio generati dal launcher: come argomenti CLI
  // duplicherebbero porte, salvataggio, credenziali o sessione.
  "queryport", "gameport", "altsavedirectoryname", "sessionname", "maxplayers",
  "serveradminpassword", "serverpassword", "spectatorpassword", "adminlisturl",
  "updateallowedcheatersinterval", "rconport", "rconenabled",
];

export function splitLaunchArgs(raw: string | undefined): string[] {
  return (raw ?? "").replace(/\r\n?/g, "\n").split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function launchArgsErrors(raw: string | undefined): string[] {
  const args = splitLaunchArgs(raw);
  if (args.length > 200) return ["Sono consentiti al massimo 200 argomenti ASA avanzati"];
  const errors: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("-") || arg === "-") {
      errors.push(`Argomento ASA avanzato non valido (deve iniziare con '-'): ${arg}`);
      continue;
    }
    if (arg.length > 4096 || arg.includes("\0")) {
      errors.push("Argomento ASA avanzato troppo lungo o non valido");
      continue;
    }
    // Il nome termina al primo "=" o spazio e ignora trattini iniziali extra (-mods 123, --Port=1).
    const name = /^-+([^=\s]*)/.exec(arg)?.[1]?.toLowerCase() ?? "";
    if (RESERVED_LAUNCH_ARGS.includes(name)) {
      errors.push(`L'argomento -${name} è gestito da un campo dedicato o dall'infrastruttura ARKSA`);
    }
  }
  return errors;
}

function sectionOf(set: IniOverrideSet, file: IniFile, key: string): string {
  return set.sections[key] ?? DEFAULT_SECTION[file];
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

type CatalogIndex = Map<string, CatalogRule>;

function indexCatalog(catalog: readonly CatalogRule[]): CatalogIndex {
  return new Map(catalog.map((rule) => [`${rule.file}:${rule.key.toLowerCase()}`, rule]));
}

function findRule(index: CatalogIndex, file: IniFile, key: string): { rule: CatalogRule; legacy: boolean } | null {
  const direct = index.get(`${file}:${key.toLowerCase()}`);
  if (direct) return { rule: direct, legacy: false };
  const moved = LEGACY_KEY_LOCATIONS[key.toLowerCase()];
  const current = moved?.legacyFile === file ? index.get(`${moved.file}:${key.toLowerCase()}`) : undefined;
  return current ? { rule: current, legacy: true } : null;
}

/** Toglie un'unica coppia di virgolette doppie esterne, se presente. */
export function unquoteIniValue(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

// Nell'URL di avvio "?" separa le opzioni e le virgolette rompono il parsing della
// riga di comando; nelle password gli spazi sono inoltre fonte di errori di digitazione.
const URL_OPTION_FORBIDDEN = /[?"]/;

function stringError(rule: CatalogRule, name: string, value: string): string | null {
  if (value !== value.trim()) return `${name}: spazi iniziali o finali non ammessi`;
  if (rule.choices) {
    return rule.choices.some((choice) => choice.value === value)
      ? null
      : `${name}: valore non ammesso (validi: ${rule.choices.map((choice) => choice.value).join(", ")})`;
  }
  const key = rule.key.toLowerCase();
  if (key === "sessionname" || key === "serverpassword" || key === "spectatorpassword") {
    if (value.length > 128) return `${name}: massimo 128 caratteri`;
    if (URL_OPTION_FORBIDDEN.test(value)) return `${name}: i caratteri ? e " non sono ammessi (finiscono nell'URL di avvio)`;
    if (key !== "sessionname" && /\s/.test(value)) return `${name}: gli spazi non sono ammessi nelle password`;
  }
  if (rule.format === "url" && !/^https?:\/\/[^\s"]+$/.test(unquoteIniValue(value))) {
    return `${name}: deve essere un indirizzo http:// o https:// senza spazi`;
  }
  if ((key === "clusterid" || key === "clusterdiroverride") && (/[\s"?]/.test(value) || value.length > 256)) {
    return `${name}: spazi, virgolette e ? non sono ammessi (max 256 caratteri)`;
  }
  if (key === "multihome" && !/^[0-9a-fA-F:.]+$/.test(value)) return `${name}: deve essere un indirizzo IP`;
  return null;
}

/** Errore in italiano se `value` non è ammesso dal campo di catalogo, altrimenti null. */
export function valueError(rule: CatalogRule, value: string): string | null {
  const name = `${rule.label} (${rule.key})`;
  if (rule.type === "bool") {
    return value === "True" || value === "False" ? null : `${name}: il valore deve essere True o False`;
  }
  if (rule.type === "int" || rule.type === "float") {
    const pattern = rule.type === "int" ? /^-?\d+$/ : /^-?(?:\d+\.?\d*|\.\d+)$/;
    if (!pattern.test(value)) {
      return `${name}: il valore deve essere un numero ${rule.type === "int" ? "intero" : "(con il punto decimale)"}`;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) return `${name}: il valore ${value} non è un numero finito`;
    const belowMin = rule.min !== undefined && number < rule.min;
    const aboveMax = rule.max !== undefined && number > rule.max;
    if (belowMin && rule.max === undefined) return `${name}: il valore ${value} è inferiore al minimo ${rule.min}`;
    if (aboveMax && rule.min === undefined) return `${name}: il valore ${value} supera il massimo ${rule.max}`;
    if (belowMin || aboveMax) return `${name}: il valore ${value} è fuori dall'intervallo ${rule.min} – ${rule.max}`;
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) return `${name}: il valore contiene caratteri di controllo`;
  if (value.length > 1024) return `${name}: il valore supera i 1024 caratteri`;
  return stringError(rule, name, value);
}

export interface ValidationOptions {
  /**
   * Con il catalogo si applicano anche i controlli di salvataggio (chiavi note,
   * tipi, intervalli, righe raw ben formate, managedKeys). Senza, resta il solo
   * sottoinsieme che l'agent applica al provisioning, così un profilo già salvato
   * non diventa inavviabile.
   */
  catalog?: readonly CatalogRule[];
}

/** Errori in italiano (vuoto se il set è valido) per un singolo file INI. */
export function validateIniSet(file: IniFile, set: IniOverrideSet, options: ValidationOptions = {}): string[] {
  const errors: string[] = [];
  const catalog = options.catalog ? indexCatalog(options.catalog) : null;
  const scalarKeys = Object.keys(set.values);
  const raw = parseRawDirectives(file, set.raw);

  // Il marker interno è un errore anche per l'agent; le righe malformate solo in salvataggio.
  if (raw.markerError) errors.push(raw.markerError);
  if (catalog) errors.push(...raw.errors);

  if (file === "GameUserSettings") {
    const forbidden = [...scalarKeys, ...raw.directives.map((directive) => directive.key)].find(isInfrastructureManagedGusKey);
    if (forbidden) errors.push(`${forbidden} è gestita dall'infrastruttura e non può essere impostata via profilo`);
  }

  for (const [key, value] of Object.entries(set.values)) {
    if (keyFromLine(`${key}=`) !== key) {
      errors.push(`Chiave INI non valida: ${key}`);
      continue;
    }
    if (value.includes("\n") || value.includes("\r")) {
      errors.push(`Il valore scalare '${key}' non può contenere nuove righe; usa l'editor avanzato`);
    }
    const section = sectionOf(set, file, key);
    if (!section || /[[\]\r\n]/.test(section)) errors.push(`Sezione INI non valida per '${key}': ${section}`);
  }

  for (const directive of raw.directives) {
    const clash = scalarKeys.find((scalar) => sameText(scalar, directive.key)
      && sameText(sectionOf(set, file, scalar), directive.section));
    if (clash) {
      errors.push(`La direttiva avanzata '${directive.key}' duplica un campo dell'editor grafico`);
      break;
    }
  }

  if (catalog) {
    for (const key of set.managedKeys ?? []) {
      if (keyFromLine(`${key}=`) !== key) errors.push(`managedKeys: chiave INI non valida: ${key}`);
      else if (!findRule(catalog, file, key)) errors.push(`managedKeys: '${key}' non appartiene al catalogo di ${file}.ini`);
    }
    for (const [key, value] of Object.entries(set.values)) {
      if (keyFromLine(`${key}=`) !== key) continue;
      const found = findRule(catalog, file, key);
      if (!found && file === "GameUserSettings" && isObsoleteInfrastructureGusKey(key)) continue;
      if (!found) {
        errors.push(`'${key}' non è un'impostazione del catalogo di ${file}.ini: usa le direttive avanzate`);
        continue;
      }
      const { rule, legacy } = found;
      if (rule.key !== key) {
        errors.push(`'${key}' va scritta come '${rule.key}'`);
        continue;
      }
      if (rule.infrastructureManaged) continue;
      if (!legacy) {
        const expected = rule.section ?? DEFAULT_SECTION[rule.file];
        const section = sectionOf(set, file, key);
        if (!sameText(section, expected) && !isLegacySection(file, key, section)) {
          errors.push(`${rule.label} (${key}) appartiene alla sezione [${expected}]`);
        }
      }
      const problem = valueError(rule, value);
      if (problem) errors.push(problem);
    }
    const scalarLower = new Set(scalarKeys.map((key) => key.toLowerCase()));
    for (const directive of raw.directives) {
      if (scalarLower.has(directive.key.toLowerCase())) continue;
      const found = findRule(catalog, file, directive.key);
      if (found && !found.legacy && sameText(directive.section, found.rule.section ?? DEFAULT_SECTION[found.rule.file])) {
        errors.push(`'${found.rule.key}' è un campo del catalogo: impostalo tra i parametri di gioco, non nelle direttive avanzate`);
      }
    }
  }
  return errors;
}

export interface ConfigSettingsInput {
  gus: IniOverrideSet;
  game: IniOverrideSet;
  launchArgs?: string;
}

/** Validazione completa di una configurazione prima del salvataggio (backend e PWA). */
export function validateConfigSettings(input: ConfigSettingsInput, catalog: readonly CatalogRule[]): string[] {
  return [
    ...validateIniSet("GameUserSettings", input.gus, { catalog }).map((message) => `GameUserSettings.ini: ${message}`),
    ...validateIniSet("Game", input.game, { catalog }).map((message) => `Game.ini: ${message}`),
    ...launchArgsErrors(input.launchArgs).map((message) => `Argomenti di avvio: ${message}`),
  ];
}
