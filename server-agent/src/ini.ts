// Impostazioni di gioco (GameUserSettings.ini / Game.ini): scritte direttamente
// sul file reale del processo ARK. Le righe non gestite vengono preservate e
// quelle del profilo precedente sostituite in modo deterministico. Il catalogo
// contiene 422 campi,
// più editor raw per direttive strutturate/ripetute e sezioni di mod.

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { log } from "./logger.js";
import { MANAGED_KEYS_BASELINE } from "./managed-settings-baseline.js";
import {
  DEFAULT_SECTION,
  MANAGED_BEGIN,
  MANAGED_END,
  isInfrastructureManagedGusKey,
  keyFromLine,
  parseRawDirectives,
  unquoteIniValue,
  validateIniSet,
  type IniFile,
  type IniOverrideSet,
} from "./shared/config-rules.js";
import { CONFIG_RULES_CATALOG } from "./shared/config-rules-catalog.js";

// `raw` contiene le direttive avanzate (chiavi ripetute, struct/array, sezioni
// di mod), `managedKeys` tutte le chiavi note all'editor anche se al default.
export type { IniFile, IniOverrideSet };

function pathFor(file: IniFile): string {
  return file === "GameUserSettings" ? config.gusIni : config.gameIni;
}

function withoutManagedBlocks(lines: string[]): string[] {
  const result: string[] = [];
  let inside = false;
  for (const line of lines) {
    const marker = line.trim();
    if (marker === MANAGED_BEGIN) {
      inside = true;
      continue;
    }
    if (marker === MANAGED_END) {
      inside = false;
      continue;
    }
    if (!inside) result.push(line);
  }
  return result;
}

function assertProfileMaySet(file: IniFile, keys: string[]): void {
  if (file !== "GameUserSettings") return;
  const forbidden = keys.find(isInfrastructureManagedGusKey);
  if (forbidden) {
    throw new Error(`${forbidden} è gestita dall'infrastruttura e non può essere impostata via profilo`);
  }
}

interface ManagedEntry {
  key: string;
  section: string;
}

interface PreviousManaged {
  initialized: boolean;
  /** Chiavi note solo per nome (sidecar scritto prima che registrasse anche le sezioni). */
  legacyKeys: string[];
  entries: ManagedEntry[];
}

async function readPreviousManaged(target: string): Promise<PreviousManaged> {
  try {
    const parsed = JSON.parse(await fs.readFile(`${target}.arksa-managed.json`, "utf8")) as {
      keys?: unknown;
      entries?: unknown;
    };
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter((entry): entry is ManagedEntry => typeof entry === "object" && entry !== null
        && typeof (entry as ManagedEntry).key === "string" && typeof (entry as ManagedEntry).section === "string")
      : [];
    const named = new Set(entries.map((entry) => entry.key.toLowerCase()));
    const keys = Array.isArray(parsed.keys) ? parsed.keys.filter((key): key is string => typeof key === "string") : [];
    return { initialized: true, legacyKeys: keys.filter((key) => !named.has(key.toLowerCase())), entries };
  } catch {
    return { initialized: false, legacyKeys: [], entries: [] };
  }
}

const QUOTED_KEYS = new Set(
  CONFIG_RULES_CATALOG.filter((rule) => rule.quoted).map((rule) => `${rule.file}:${rule.key.toLowerCase()}`),
);

// ASA richiede le virgolette attorno ad alcuni URL (BanListURL): le aggiunge
// l'agent, così l'utente inserisce solo l'indirizzo e un valore già quotato
// (profili salvati) non viene quotato due volte.
function serializeValue(file: IniFile, key: string, value: string): string {
  return QUOTED_KEYS.has(`${file}:${key.toLowerCase()}`) ? `"${unquoteIniValue(value)}"` : value;
}

const CATALOG_SECTIONS = new Map(CONFIG_RULES_CATALOG.map((rule) => [`${rule.file}:${rule.key.toLowerCase()}`, rule.section]));

/**
 * Sezioni in cui una chiave gestita va rimossa. Una chiave omonima in un'altra
 * sezione (per esempio `Duration` o `Message` di una mod) non è nostra e resta.
 * "any" vale solo per le chiavi di cui non si conosce la sezione (sidecar
 * vecchio o nome estraneo al catalogo): ripulite ovunque come prima.
 */
class ManagedSections {
  private readonly byKey = new Map<string, Set<string> | "any">();

  constructor(private readonly file: IniFile) {}

  add(key: string, section: string): void {
    const lower = key.toLowerCase();
    const current = this.byKey.get(lower);
    if (current === "any") return;
    const sections = current ?? new Set<string>();
    sections.add(section.toLowerCase());
    this.byKey.set(lower, sections);
  }

  addAnywhere(key: string): void {
    this.byKey.set(key.toLowerCase(), "any");
  }

  addCatalogKey(key: string, explicitSection?: string): void {
    const known = CATALOG_SECTIONS.has(`${this.file}:${key.toLowerCase()}`);
    if (known) this.add(key, CATALOG_SECTIONS.get(`${this.file}:${key.toLowerCase()}`) ?? DEFAULT_SECTION[this.file]);
    if (explicitSection) this.add(key, explicitSection);
    if (!known && !explicitSection) this.addAnywhere(key);
  }

  covers(key: string, section: string): boolean {
    const sections = this.byKey.get(key.toLowerCase());
    return sections === "any" || (sections?.has(section.toLowerCase()) ?? false);
  }
}

async function writeFileAtomic(target: string, content: string, fallbackMode: number): Promise<void> {
  // ASA e il launcher si aspettano i permessi già presenti (GameUserSettings.ini
  // è 0600 perché contiene la password admin): il rename non deve allargarli.
  let mode = fallbackMode;
  try {
    mode = (await fs.stat(target)).mode & 0o777;
  } catch {
    // File nuovo: vale il fallback.
  }
  const tmp = `${target}.arksa-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(tmp, content, { encoding: "utf8", mode });
    await fs.chmod(tmp, mode);
    await fs.rename(tmp, target);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/**
 * Sostituisce la configurazione gestita dalla PWA, invece di applicare una
 * patch cumulativa. È essenziale quando si cambia profilo: una chiave assente
 * dal nuovo profilo deve tornare al default del gioco, non ereditare il valore
 * del profilo avviato in precedenza.
 *
 * Le righe esterne al blocco ARKSA vengono preservate. Al primo passaggio dopo
 * l'upgrade vengono ripulite anche le vecchie chiavi scritte senza marker;
 * l'elenco nel sidecar rende la pulizia affidabile anche se ASA riscrive i
 * commenti del file durante lo shutdown.
 */
export async function replaceManagedIni(file: IniFile, settings: IniOverrideSet): Promise<void> {
  const target = pathFor(file);
  let content = "";
  try {
    content = await fs.readFile(target, "utf8");
  } catch {
    // Il file viene creato sotto, anche per una configurazione interamente a default.
  }

  const [invalid] = validateIniSet(file, settings);
  if (invalid) throw new Error(invalid);
  const advanced = settings.raw?.trim() ? settings.raw.replace(/\r\n?/g, "\n").split("\n") : [];
  const advancedKeys = advanced.map(keyFromLine).filter((key): key is string => key !== null);
  const scalarKeys = Object.keys(settings.values);

  const previous = await readPreviousManaged(target);
  const directives = parseRawDirectives(file, settings.raw).directives;
  const managed = new ManagedSections(file);
  if (previous.initialized) {
    previous.legacyKeys.forEach((key) => managed.addAnywhere(key));
    previous.entries.forEach((entry) => managed.add(entry.key, entry.section));
  } else {
    MANAGED_KEYS_BASELINE[file].forEach((key) => managed.addCatalogKey(key));
  }
  for (const key of settings.managedKeys ?? []) managed.addCatalogKey(key, settings.sections[key]);
  for (const key of scalarKeys) managed.add(key, settings.sections[key] ?? DEFAULT_SECTION[file]);
  for (const directive of directives) managed.add(directive.key, directive.section);

  let currentSection = "";
  let lines = withoutManagedBlocks(content.replace(/\r\n?/g, "\n").split("\n"));
  lines = lines.filter((line) => {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header?.[1]) currentSection = header[1];
    const key = keyFromLine(line);
    return key === null || !managed.covers(key, currentSection);
  });
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();

  const grouped = new Map<string, [string, string][]>();
  for (const [key, value] of Object.entries(settings.values)) {
    const section = settings.sections[key] ?? DEFAULT_SECTION[file];
    const entries = grouped.get(section) ?? [];
    entries.push([key, value]);
    grouped.set(section, entries);
  }

  if (grouped.size > 0 || advanced.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(MANAGED_BEGIN);
    for (const [section, entries] of grouped) {
      lines.push(`[${section}]`);
      for (const [key, value] of entries) lines.push(`${key}=${serializeValue(file, key, value)}`);
      lines.push("");
    }
    if (advanced.length > 0) {
      // Le direttive senza header appartengono alla sezione predefinita;
      // eventuali header successivi consentono anche sezioni di mod/custom.
      lines.push(`[${DEFAULT_SECTION[file]}]`, ...advanced, "");
    }
    while (lines.at(-1) === "") lines.pop();
    lines.push(MANAGED_END);
  }

  await fs.mkdir(target.substring(0, target.lastIndexOf("/")), { recursive: true });
  // GameUserSettings.ini conterrà la password admin: nasce riservato come lo crea il launcher.
  await writeFileAtomic(target, `${lines.join("\n")}\n`, file === "GameUserSettings" ? 0o600 : 0o644);
  const written: ManagedEntry[] = [
    ...scalarKeys.map((key) => ({ key, section: settings.sections[key] ?? DEFAULT_SECTION[file] })),
    ...directives.map((directive) => ({ key: directive.key, section: directive.section })),
  ];
  await writeFileAtomic(
    `${target}.arksa-managed.json`,
    JSON.stringify({ keys: [...new Set(written.map((entry) => entry.key))], entries: written }, null, 2),
    0o644,
  );
  log.info(`Sostituito blocco gestito in ${file}.ini (${scalarKeys.length} campi, ${advancedKeys.length} direttive avanzate)`);
}

/**
 * Materializza nel solo INI runtime le impostazioni amministrative possedute
 * dall'infrastruttura. ASA può ripristinare valori storici sia all'avvio sia
 * allo shutdown: questa funzione viene quindi richiamata dopo RCON-online e
 * dopo lo stop. Non è esposta dalle rotte di scrittura e readIni le oscura.
 */
export async function synchronizeInfrastructureGameUserSettings(): Promise<void> {
  if (!config.rconPassword) throw new Error("RCON_PASSWORD richiesta per sincronizzare ServerAdminPassword");
  const target = pathFor("GameUserSettings");
  let content = "";
  try {
    content = await fs.readFile(target, "utf8");
  } catch {
    // Il file può non esistere al primissimo boot: viene creato sotto.
  }

  const desired = [
    `ServerAdminPassword=${config.rconPassword}`,
    `AdminListURL="${config.adminListUrl}"`,
    `UpdateAllowedCheatersInterval=${config.adminListRefreshSeconds}`,
    `RCONPort=${config.rconPort}`,
  ];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const next: string[] = [];
  let inserted = false;
  for (const line of lines) {
    const key = keyFromLine(line);
    if (key && isInfrastructureManagedGusKey(key)) continue;
    next.push(line);
    if (!inserted && line.trim().toLowerCase() === "[serversettings]") {
      next.push(...desired);
      inserted = true;
    }
  }
  if (!inserted) {
    while (next.length > 0 && next.at(-1)?.trim() === "") next.pop();
    if (next.length > 0) next.push("");
    next.push("[ServerSettings]", ...desired);
  }
  const updated = `${next.join("\n").replace(/\n+$/, "")}\n`;
  if (updated === content) {
    await fs.chmod(target, 0o600);
    return;
  }

  await fs.mkdir(target.substring(0, target.lastIndexOf("/")), { recursive: true });
  const tmp = `${target}.arksa-admin-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(tmp, updated, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, target);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  log.info("Impostazioni amministrative runtime riallineate dall'infrastruttura");
}

/** Legge le impostazioni di gioco attualmente scritte nel file .ini reale. */
export async function readIni(file: IniFile): Promise<Record<string, string>> {
  const target = pathFor(file);
  let content = "";
  try {
    content = await fs.readFile(target, "utf8");
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const key = keyFromLine(line);
    if (!key) continue;
    // Anche un residuo storico non deve mai attraversare l'API dell'agent.
    if (file === "GameUserSettings" && isInfrastructureManagedGusKey(key)) continue;
    values[key] = line.slice(line.indexOf("=") + 1).trim();
  }
  return values;
}
