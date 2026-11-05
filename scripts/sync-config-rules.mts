// Sincronizza le regole di validazione condivise dalla loro sorgente unica
// (control-plane/pwa/src/configRules.ts + catalogo PWA) verso backend e agent,
// che hanno build Docker separate e non possono importare fuori dal proprio
// pacchetto. Uso, dalla cartella server-agent (dove è installato tsx):
//   node --import tsx ../scripts/sync-config-rules.mts          # riscrive le copie
//   node --import tsx ../scripts/sync-config-rules.mts --check  # esce con 1 se divergono

import { promises as fs } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const RULES_SOURCE = "control-plane/pwa/src/configRules.ts";
const HEADER = `// GENERATO da scripts/sync-config-rules.mts: non modificare a mano.\n// Sorgente: ${RULES_SOURCE}\n`;

interface CatalogField {
  key: string;
  file: string;
  label: string;
  section?: string;
  type: string;
  min?: number;
  max?: number;
  infrastructureManaged?: boolean;
  choices?: Array<{ value: string }>;
  format?: string;
  quoted?: boolean;
}

/** Contenuto atteso di ogni file generato, indicizzato per percorso dalla radice del repo. */
export async function expectedGeneratedFiles(): Promise<Record<string, string>> {
  const rules = await fs.readFile(new URL(RULES_SOURCE, root), "utf8");
  const { ALL_GAME_SETTING_FIELDS } = await import(
    new URL("control-plane/pwa/src/gameSettingsSchema.ts", root).href
  ) as { ALL_GAME_SETTING_FIELDS: CatalogField[] };
  const entries = ALL_GAME_SETTING_FIELDS.map((field) => {
    const rule: Record<string, unknown> = { key: field.key, file: field.file, label: field.label, type: field.type };
    if (field.section) rule.section = field.section;
    if (field.min !== undefined) rule.min = field.min;
    if (field.max !== undefined) rule.max = field.max;
    if (field.infrastructureManaged) rule.infrastructureManaged = true;
    if (field.choices) rule.choices = field.choices.map((choice) => ({ value: choice.value }));
    if (field.format) rule.format = field.format;
    if (field.quoted) rule.quoted = true;
    return `  ${JSON.stringify(rule)},`;
  });
  const catalog = `${HEADER}// e dal catalogo control-plane/pwa/src/gameSettingsSchema.ts\n\nimport type { CatalogRule } from "./config-rules.js";\n\n`
    + `export const CONFIG_RULES_CATALOG: readonly CatalogRule[] = [\n${entries.join("\n")}\n];\n`;
  return {
    "control-plane/backend/src/shared/config-rules.ts": `${HEADER}${rules}`,
    "control-plane/backend/src/shared/config-rules-catalog.ts": catalog,
    "server-agent/src/shared/config-rules.ts": `${HEADER}${rules}`,
    "server-agent/src/shared/config-rules-catalog.ts": catalog,
  };
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [path, content] of Object.entries(await expectedGeneratedFiles())) {
    const target = new URL(path, root);
    const current = await fs.readFile(target, "utf8").catch(() => null);
    if (current === content) continue;
    stale += 1;
    if (check) {
      console.error(`Non sincronizzato: ${path}`);
    } else {
      await fs.mkdir(new URL(".", target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      console.log(`Aggiornato ${fileURLToPath(target)}`);
    }
  }
  if (check && stale > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
