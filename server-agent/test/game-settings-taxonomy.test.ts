import assert from "node:assert/strict";
import test from "node:test";

interface GameSettingField {
  key: string;
  tags: string[];
}

interface GameSettingCategory {
  id: string;
  description: string;
  fields: GameSettingField[];
}

const schemaUrl = new URL("../../control-plane/pwa/src/gameSettingsSchema.ts", import.meta.url).href;
const taxonomyUrl = new URL("../../control-plane/pwa/src/gameSettingsTaxonomy.ts", import.meta.url).href;
const schema = await import(schemaUrl) as {
  ALL_GAME_SETTING_FIELDS: GameSettingField[];
  GAME_SETTINGS: GameSettingCategory[];
};
const taxonomy = await import(taxonomyUrl) as {
  GAME_SETTING_TAGS: Array<{ id: string }>;
  gameSettingMatchesQuery: (field: GameSettingField, query: string, categoryLabel?: string) => boolean;
};
const { ALL_GAME_SETTING_FIELDS, GAME_SETTINGS } = schema;
const { GAME_SETTING_TAGS, gameSettingMatchesQuery } = taxonomy;

function field(key: string): GameSettingField {
  const match = ALL_GAME_SETTING_FIELDS.find((candidate) => candidate.key === key);
  assert.ok(match, `campo atteso non trovato: ${key}`);
  return match;
}

function categoryOf(key: string): string | undefined {
  return GAME_SETTINGS.find((category) => category.fields.some((candidate) => candidate.key === key))?.id;
}

test("la tassonomia assegna una categoria e tag normalizzati a tutti i 422 campi", () => {
  const knownTags = new Set(GAME_SETTING_TAGS.map((tag) => tag.id));
  const categorizedKeys = GAME_SETTINGS.flatMap((category) => category.fields.map((setting) => setting.key));

  assert.equal(categorizedKeys.length, 422);
  assert.equal(new Set(categorizedKeys).size, 422, "una chiave compare in più categorie");
  assert.ok(GAME_SETTINGS.every((category) => category.description.trim().length > 0));
  assert.ok(GAME_SETTINGS.every((category) => !category.id.includes("extra")), "restano categorie legacy *-extra");

  for (const setting of ALL_GAME_SETTING_FIELDS) {
    assert.ok(setting.tags.length > 0, `${setting.key} non ha tag`);
    assert.equal(new Set(setting.tags).size, setting.tags.length, `tag duplicati per ${setting.key}`);
    for (const tag of setting.tags) assert.ok(knownTags.has(tag), `tag non normalizzato ${tag} su ${setting.key}`);
  }
});

test("le aree ARK principali separano allevamento, statistiche, cryopod e mappe", () => {
  assert.equal(categoryOf("MatingIntervalMultiplier"), "breeding");
  assert.equal(categoryOf("BabyMatureSpeedMultiplier"), "breeding");
  assert.equal(categoryOf("PerLevelStatsMultiplier_Player[0]"), "stats");
  assert.equal(categoryOf("EnableCryopodNerf"), "cryopods");
  assert.equal(categoryOf("LimitBunkersPerTribe"), "maps");
  assert.equal(categoryOf("LimitTurretsNum"), "structures");

  assert.ok(field("MatingIntervalMultiplier").tags.includes("accoppiamento"));
  assert.ok(field("BabyMatureSpeedMultiplier").tags.includes("cuccioli"));
  assert.ok(field("BabyImprintAmountMultiplier").tags.includes("imprinting"));
  assert.ok(field("TamedDinoDamageMultiplier").tags.includes("addomesticati"));
});

test("i tag scelti a mano correggono i falsi positivi dell'euristica", () => {
  const expectations: Record<string, { has: string[]; lacks: string[] }> = {
    ServerPlatform: { has: ["avvio", "accesso"], lacks: ["strutture"] },
    BanListURL: { has: ["accesso"], lacks: ["tempo"] },
    serverPVE: { has: ["pve", "pvp"], lacks: ["strutture", "raid", "tribu"] },
    PlayerDamageMultiplier: { has: ["giocatore", "danno"], lacks: ["strutture", "creature"] },
    ServerAdminPassword: { has: ["accesso", "amministrazione"], lacks: ["strutture", "regole"] },
    AdminListURL: { has: ["accesso"], lacks: ["strutture"] },
    HairGrowthSpeedMultiplier: { has: ["giocatore"], lacks: ["cuccioli"] },
    SpectatorPassword: { has: ["accesso"], lacks: ["creature", "mondo"] },
  };
  for (const [key, { has, lacks }] of Object.entries(expectations)) {
    const tags = field(key).tags;
    for (const tag of has) assert.ok(tags.includes(tag), `${key} dovrebbe avere il tag ${tag}: ${tags.join(",")}`);
    for (const tag of lacks) assert.ok(!tags.includes(tag), `${key} non dovrebbe avere il tag ${tag}: ${tags.join(",")}`);
  }
  assert.ok(field("KickIdlePlayersPeriod").tags.length <= 4);
});

test("la ricerca indicizza chiave, etichetta, descrizione e nome italiano dei tag", () => {
  const mating = field("MatingIntervalMultiplier");
  assert.ok(gameSettingMatchesQuery(mating, "MatingInterval"));
  assert.ok(gameSettingMatchesQuery(mating, "Intervallo tra accoppiamenti"));
  assert.ok(gameSettingMatchesQuery(mating, "coppia di dinosauri"));
  assert.ok(gameSettingMatchesQuery(mating, "Accoppiamento"));
  assert.ok(!gameSettingMatchesQuery(mating, "whitelist esclusiva"));
});
