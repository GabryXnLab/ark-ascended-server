/**
 * Tassonomia di navigazione dell'editor ASA.
 *
 * Il catalogo INI resta ordinato per provenienza in gameSettingsSchema.ts; qui
 * lo ricomponiamo nelle sezioni che un giocatore incontra nelle impostazioni
 * host di ARK e ricaviamo tag trasversali utili alla ricerca. La classificazione
 * non cambia file, sezione, default o serializzazione di nessuna chiave.
 */

export const GAME_SETTING_TAGS = [
  { id: "sessione", label: "Sessione" },
  { id: "difficolta", label: "Difficoltà" },
  { id: "esperienza", label: "Esperienza" },
  { id: "giocatore", label: "Giocatore" },
  { id: "creature", label: "Creature" },
  { id: "selvatici", label: "Dino selvatici" },
  { id: "addomesticati", label: "Dino addomesticati" },
  { id: "taming", label: "Addomesticamento" },
  { id: "allevamento", label: "Allevamento" },
  { id: "accoppiamento", label: "Accoppiamento" },
  { id: "cuccioli", label: "Crescita cuccioli" },
  { id: "imprinting", label: "Imprinting" },
  { id: "statistiche", label: "Statistiche" },
  { id: "salute", label: "Salute" },
  { id: "stamina", label: "Stamina" },
  { id: "cibo", label: "Cibo" },
  { id: "danno", label: "Danno e resistenza" },
  { id: "raccolta", label: "Raccolta" },
  { id: "risorse", label: "Risorse" },
  { id: "loot", label: "Loot" },
  { id: "crafting", label: "Crafting" },
  { id: "oggetti", label: "Oggetti" },
  { id: "strutture", label: "Strutture" },
  { id: "decadimento", label: "Decadimento" },
  { id: "pve", label: "PvE" },
  { id: "pvp", label: "PvP" },
  { id: "tribu", label: "Tribù e alleanze" },
  { id: "raid", label: "Raid" },
  { id: "mondo", label: "Mondo" },
  { id: "spawn", label: "Spawn" },
  { id: "tempo", label: "Tempo e ambiente" },
  { id: "trasferimenti", label: "Trasferimenti" },
  { id: "cluster", label: "Cluster" },
  { id: "chat", label: "Chat" },
  { id: "hud", label: "HUD e visuale" },
  { id: "cryopod", label: "Cryopod" },
  { id: "engrammi", label: "Engrammi" },
  { id: "mappe", label: "Mappe e contenuti" },
  { id: "accesso", label: "Accesso e sicurezza" },
  { id: "log", label: "Log" },
  { id: "amministrazione", label: "Amministrazione" },
  { id: "avvio", label: "Avvio server" },
  { id: "prestazioni", label: "Prestazioni" },
  { id: "regole", label: "Regole di gioco" },
] as const;

export type GameSettingTagId = (typeof GAME_SETTING_TAGS)[number]["id"];

export const GAME_SETTING_TAG_LABELS = Object.fromEntries(
  GAME_SETTING_TAGS.map((tag) => [tag.id, tag.label]),
) as Record<GameSettingTagId, string>;

interface TaggableSetting {
  key: string;
  label: string;
  help?: string;
  section?: string;
}

interface SearchableSetting extends TaggableSetting {
  tags: GameSettingTagId[];
}

/** Testo normalizzato indicizzato dalla ricerca dell'editor. */
export function gameSettingSearchText(field: SearchableSetting, categoryLabel = ""): string {
  const tagText = field.tags.map((tag) => GAME_SETTING_TAG_LABELS[tag]).join(" ");
  return `${field.key} ${field.label} ${field.help ?? ""} ${tagText} ${categoryLabel}`.toLocaleLowerCase("it");
}

export function gameSettingMatchesQuery(field: SearchableSetting, query: string, categoryLabel = ""): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("it");
  return normalizedQuery === "" || gameSettingSearchText(field, categoryLabel).includes(normalizedQuery);
}

const TAG_MATCHERS: ReadonlyArray<{ id: GameSettingTagId; pattern: RegExp }> = [
  { id: "sessione", pattern: /session|serverpassword|spectator|multihome|maxplayers|autosave|idle|rcon|motd|messageoftheday/ },
  { id: "difficolta", pattern: /difficulty|difficolt|hardcore|singleplayer/ },
  { id: "esperienza", pattern: /\bxp\b|experience|levelup|livell/ },
  { id: "giocatore", pattern: /player|survivor|giocatore|personaggio|impianto|malatti|respawn/ },
  { id: "creature", pattern: /dino|creatur|npc|gacha|unicorn|armadoggo|ice fox|reaper|cosmo|tame/ },
  { id: "selvatici", pattern: /wild|selvatic|spawn.*dino|dinocount/ },
  { id: "addomesticati", pattern: /tamed|tame\b|addomesticat|unclaim|raid dino/ },
  { id: "taming", pattern: /taming|tameinterval|addomesticamento|addomesticare/ },
  { id: "allevamento", pattern: /breed|allev|mating|preventmate|\bmate\b|layegg|^egg|baby|cucciol|cuddle|imprint|pregnan|gestation|incub|\buov(?:a|o|e)\b/ },
  { id: "accoppiamento", pattern: /mating|preventmate|\bmate\b|accoppi|deposizione|layegg|pregnan|gestation/ },
  { id: "cuccioli", pattern: /baby|cucciol|mature|crescita|hatch|schius|layegg|^egg|\buov(?:a|o|e)\b/ },
  { id: "imprinting", pattern: /imprint|cuddle|coccol/ },
  { id: "statistiche", pattern: /perlevelstats|basestat|statmultiplier|stat scale|statistic|health|stamina|food|water|oxygen|torpor|weight|speedlevel|mutagen/ },
  { id: "salute", pattern: /health|salute|hp\b/ },
  { id: "stamina", pattern: /stamina/ },
  { id: "cibo", pattern: /food|cibo|fame/ },
  { id: "danno", pattern: /damage|resistance|danno|resistenza|turret|torrett|friendlyfire/ },
  { id: "raccolta", pattern: /harvest|raccolt|fishing|pesca/ },
  { id: "risorse", pattern: /resource|risors|replenish/ },
  { id: "loot", pattern: /loot|crate|supply|bottino/ },
  { id: "crafting", pattern: /craft|recipe|ricett|bloodforge/ },
  { id: "oggetti", pattern: /item|stack|spoiling|decompos|oggett|inventar/ },
  { id: "strutture", pattern: /structure|struttur|building|build|foundation|gate|platform|saddle|generator|turret|bunker|outpost|tower/ },
  { id: "decadimento", pattern: /decay|decad|autodestroy|decompos/ },
  { id: "pve", pattern: /pve/ },
  { id: "pvp", pattern: /pvp|offline raid|orp\b/ },
  { id: "tribu", pattern: /tribe|tribù|alliance|alleanz|pin code/ },
  { id: "raid", pattern: /raid|turret|torrett|mountedweapon/ },
  { id: "mondo", pattern: /world|mondo|corpse|cadaver|cave|grotte|tether/ },
  { id: "spawn", pattern: /spawn|respawn|stasis|stasi/ },
  { id: "tempo", pattern: /daytime|nighttime|temperature|volcano|intervallo|interval|period|duration|cooldown/ },
  { id: "trasferimenti", pattern: /transfer|tribute|upload|download|tributo/ },
  { id: "cluster", pattern: /cluster|crossark/ },
  { id: "chat", pattern: /chat|voice|voce|badword/ },
  { id: "hud", pattern: /hud|crosshair|hitmarker|floatingdamage|thirdperson|gamma|photo|mappa.*posizione|mapplayer/ },
  { id: "cryopod", pattern: /cryo/ },
  { id: "engrammi", pattern: /engram/ },
  { id: "mappe", pattern: /genesis|ragnarok|valguero|fjordur|lost colony|hexagon|bunker|outpost|worldbuff|volcano|map item|armadoggo|ice fox|cosmo/ },
  { id: "accesso", pattern: /password|ban|whitelist|exclusive|cheater|mesh|access|connession|security|allowed/ },
  { id: "log", pattern: /\blog|logging|tracker|notify/ },
  { id: "amministrazione", pattern: /admin|rcon|dynamicconfig|livetuning|restart|backup/ },
  { id: "avvio", pattern: /arks a\.launch|arksa\.launch|serverplatform|nodinos|nowildbabies|forceallow|launch|avvio/ },
  { id: "prestazioni", pattern: /network|stasis|process|optimized|limit.*range|maxstructures|performance/ },
  { id: "regole", pattern: /allow|prevent|disable|enable|force|only|regol/ },
];

// L'euristica sul testo dà falsi positivi (per esempio "platform" come struttura,
// "periodicamente" come tempo): per queste chiavi i tag sono scelti a mano e
// sostituiscono quelli inferiti. La categoria primaria viene aggiunta comunque.
const TAG_OVERRIDES: Readonly<Record<string, readonly GameSettingTagId[]>> = {
  ServerAdminPassword: ["accesso", "amministrazione"],
  SpectatorPassword: ["sessione", "accesso"],
  serverPVE: ["sessione", "pve", "pvp"],
  ServerHardcore: ["sessione", "difficolta", "giocatore"],
  ServerForceNoHUD: ["sessione", "hud"],
  ProximityChat: ["sessione", "chat"],
  AutoSavePeriodMinutes: ["sessione", "tempo"],
  KickIdlePlayersPeriod: ["sessione", "giocatore", "tempo"],
  RCONPort: ["sessione", "amministrazione"],
  BanListURL: ["sessione", "accesso"],
  DifficultyOffset: ["difficolta", "creature", "loot"],
  OverrideOfficialDifficulty: ["difficolta", "creature", "selvatici", "loot"],
  HarvestHealthMultiplier: ["raccolta", "risorse"],
  ResourcesRespawnPeriodMultiplier: ["raccolta", "risorse", "spawn", "tempo"],
  CustomRecipeSkillMultiplier: ["crafting"],
  PlayerCharacterFoodDrainMultiplier: ["giocatore", "statistiche", "cibo"],
  PlayerDamageMultiplier: ["giocatore", "danno"],
  PlayerResistanceMultiplier: ["giocatore", "danno"],
  NonPermanentDiseases: ["giocatore"],
  PreventDiseases: ["giocatore"],
  EnablePvPGamma: ["giocatore", "pvp", "hud"],
  DinoDamageMultiplier: ["creature", "selvatici", "danno"],
  DinoResistanceMultiplier: ["creature", "selvatici", "danno"],
  RaidDinoCharacterFoodDrainMultiplier: ["creature", "raid", "cibo"],
  ServerAutoForceRespawnWildDinosInterval: ["creature", "selvatici", "spawn", "tempo"],
  HairGrowthSpeedMultiplier: ["giocatore", "tempo"],
  bAllowUnclaimDinos: ["creature", "addomesticati", "regole"],
  bUseDinoLevelUpAnimations: ["creature", "hud"],
  MaxCosmoWeaponAmmo: ["creature", "mappe"],
  MaxHexagonsPerCharacter: ["giocatore", "mappe"],
  PreventMateBoost: ["allevamento", "accoppiamento", "regole"],
  DisableImprintDinoBuff: ["allevamento", "imprinting", "regole"],
  LayEggIntervalMultiplier: ["allevamento", "accoppiamento", "tempo"],
  BabyFoodConsumptionSpeedMultiplier: ["allevamento", "cuccioli", "cibo"],
  BabyImprintingStatScaleMultiplier: ["allevamento", "cuccioli", "imprinting", "statistiche"],
  UseOptimizedHarvestingHealth: ["raccolta", "risorse", "prestazioni"],
  ResourceNoReplenishRadiusStructures: ["raccolta", "risorse", "strutture"],
  UseCorpseLifeSpanMultiplier: ["mondo", "tempo"],
  LimitNonPlayerDroppedItemsCount: ["oggetti", "prestazioni"],
  LimitNonPlayerDroppedItemsRange: ["oggetti", "prestazioni"],
  ExcludeItemIndices: ["oggetti"],
  StructureDamageMultiplier: ["strutture", "danno"],
  AlwaysAllowStructurePickup: ["strutture", "regole"],
  AutoDestroyOldStructuresMultiplier: ["strutture", "decadimento", "tempo"],
  OnlyDecayUnsnappedCoreStructures: ["strutture", "decadimento", "regole"],
  DisableStructureDecayPvE: ["strutture", "decadimento", "pve", "regole"],
  PvEStructureDecayPeriodMultiplier: ["strutture", "decadimento", "pve", "tempo"],
  MaxGateFrameOnSaddles: ["strutture", "creature"],
  PersonalTamedDinosSaddleStructureCost: ["strutture", "creature"],
  EnableExtraStructurePreventionVolumes: ["strutture", "regole"],
  OverrideStructurePlatformPrevention: ["strutture", "regole"],
  AllowMultipleAttachedC4: ["strutture", "raid", "regole"],
  AutoDestroyDecayedDinos: ["creature", "addomesticati", "decadimento"],
  IgnorePVPMountedWeaponryRestrictions: ["pvp", "raid", "regole"],
  PreventOfflinePvPInterval: ["tribu", "pvp", "tempo"],
  PvPStructureDecay: ["tribu", "strutture", "decadimento", "pvp"],
  PreventOfflinePvPConnectionInvincibleInterval: ["tribu", "pvp", "tempo"],
  TribeMergeAllowed: ["tribu", "regole"],
  DayCycleSpeedScale: ["mondo", "tempo"],
  CropGrowthSpeedMultiplier: ["mondo", "raccolta"],
  RandomSupplyCratePoints: ["mondo", "loot"],
  ClampResourceHarvestDamage: ["mondo", "raccolta", "risorse", "danno"],
  GlobalItemDecompositionTimeMultiplier: ["mondo", "oggetti", "decadimento"],
  GlobalCorpseDecompositionTimeMultiplier: ["mondo", "decadimento"],
  PhotoModeRangeLimit: ["mondo", "hud"],
  BadWordWhiteListURL: ["chat"],
  EnemyAccessBunkerHPThreshold: ["mappe", "strutture"],
  CustomDynamicConfigUrl: ["amministrazione", "avvio"],
  AdminListURL: ["amministrazione", "accesso"],
  UpdateAllowedCheatersInterval: ["amministrazione", "accesso", "tempo"],
  AutoRestartIntervalSeconds: ["amministrazione", "tempo"],
  EnableIdlePlayerKick: ["avvio", "sessione", "giocatore", "tempo"],
  ServerPlatform: ["avvio", "accesso"],
  AdjustableMutagenSpawnDelayMultiplier: ["mappe", "spawn", "tempo"],
  ValgueroMemorialEntries: ["mappe"],
};

export function inferGameSettingTags(field: TaggableSetting): GameSettingTagId[] {
  const override = TAG_OVERRIDES[field.key];
  if (override) return [...override];
  const searchable = `${field.key} ${field.label} ${field.help ?? ""} ${field.section ?? ""}`.toLocaleLowerCase("it");
  return TAG_MATCHERS.filter(({ pattern }) => pattern.test(searchable)).map(({ id }) => id);
}

export interface OrganizedGameSettingCategory<T extends TaggableSetting & { tags: GameSettingTagId[] }> {
  id: string;
  label: string;
  description: string;
  fields: T[];
}

interface CategoryDefinition {
  id: string;
  label: string;
  description: string;
  primaryTag: GameSettingTagId;
}

const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  { id: "session", label: "Generale", description: "Sessione, accesso, salvataggi e regole fondamentali del server.", primaryTag: "sessione" },
  { id: "rates", label: "Tassi e difficoltà", description: "Difficoltà, esperienza e moltiplicatori globali come nell'host menu di ARK.", primaryTag: "difficolta" },
  { id: "player", label: "Giocatore", description: "Statistiche, sopravvivenza, visuale e qualità di vita del sopravvissuto.", primaryTag: "giocatore" },
  { id: "creatures", label: "Creature e taming", description: "Creature selvatiche e addomesticate, tame, cavalcature e limiti.", primaryTag: "creature" },
  { id: "breeding", label: "Allevamento", description: "Accoppiamento, uova, crescita dei cuccioli e imprinting.", primaryTag: "allevamento" },
  { id: "stats", label: "Statistiche per livello", description: "Progressione di giocatori e creature, valori base e bonus Mutagene.", primaryTag: "statistiche" },
  { id: "harvesting", label: "Raccolta e risorse", description: "Raccolta, rigenerazione delle risorse e resa di giocatori e creature.", primaryTag: "raccolta" },
  { id: "items", label: "Oggetti, crafting e loot", description: "Inventari, crafting, ricette, qualità del loot e deperimento.", primaryTag: "oggetti" },
  { id: "structures", label: "Strutture", description: "Costruzione, pickup, decadimento, piattaforme, generatori e torrette.", primaryTag: "strutture" },
  { id: "tribes", label: "PvE, PvP e tribù", description: "Fuoco amico, raid, protezioni offline, tribù e alleanze.", primaryTag: "tribu" },
  { id: "world", label: "Mondo e ambiente", description: "Ciclo giorno/notte, spawn, cadaveri, navigazione e regole del mondo.", primaryTag: "mondo" },
  { id: "transfers", label: "Trasferimenti e cluster", description: "Tributo, upload/download, scadenze e collegamenti CrossARK.", primaryTag: "trasferimenti" },
  { id: "interface", label: "Chat, HUD e visuale", description: "Chat e voce, filtri dei nomi, HUD e feedback a schermo.", primaryTag: "hud" },
  { id: "cryopods", label: "Cryopod", description: "Cryosickness, Cryofridge e comportamento delle creature crioconservate.", primaryTag: "cryopod" },
  { id: "maps", label: "Mappe e Lost Colony", description: "Impostazioni specifiche di mappe, missioni, Lost Colony e contenuti ASA.", primaryTag: "mappe" },
  { id: "gameplay", label: "Regole di gioco", description: "Engrammi, modalità creative e regole trasversali del gameplay.", primaryTag: "regole" },
  { id: "administration", label: "Amministrazione e sicurezza", description: "Log, whitelist, anti-mesh, tuning e strumenti amministrativi.", primaryTag: "amministrazione" },
  { id: "startup", label: "Avvio e piattaforme", description: "Argomenti materializzati dal launcher e compatibilità cross-platform.", primaryTag: "avvio" },
];

const BREEDING_PATTERN = /mating|mate|baby|cuddle|imprint|egg|hatch|breed|pregnan|layegg/i;

function categoryIdFor(field: TaggableSetting & { tags: GameSettingTagId[] }, sourceId: string): string {
  if (field.tags.includes("cryopod")) return "cryopods";
  if ((sourceId === "dino" || sourceId === "dino-extra" || sourceId === "rules-extra") && BREEDING_PATTERN.test(`${field.key} ${field.label}`)) return "breeding";

  switch (sourceId) {
    case "general": return "session";
    case "rates": return "rates";
    case "player": return "player";
    case "dino":
    case "dino-extra": return field.tags.includes("raccolta") ? "harvesting" : "creatures";
    case "structures":
    case "structures-extra": return "structures";
    case "world": return "world";
    case "pvp":
    case "friendly-fire": return "tribes";
    case "transfer": return "transfers";
    case "chat": return "interface";
    case "admin":
    case "logging-security": return "administration";
    case "harvest-loot-extra":
      if (field.tags.includes("taming") || field.tags.includes("creature")) return "creatures";
      return field.tags.includes("raccolta") || field.tags.includes("risorse") ? "harvesting" : "items";
    case "asa-map-features":
    case "lost-colony": return "maps";
    case "launch-options": return "startup";
    case "stats-per-level": return "stats";
    case "rules-extra":
      if (field.tags.includes("creature") || field.tags.includes("taming")) return "creatures";
      if (field.tags.includes("strutture")) return "structures";
      if (field.tags.includes("oggetti") || field.tags.includes("crafting") || field.tags.includes("loot") || field.tags.includes("engrammi")) return "items";
      if (field.tags.includes("pve") || field.tags.includes("pvp") || field.tags.includes("tribu")) return "tribes";
      if (field.tags.includes("giocatore")) return "player";
      if (field.tags.includes("mondo") || field.tags.includes("tempo")) return "world";
      return "gameplay";
    default: return "gameplay";
  }
}

/** Ricompone il catalogo garantendo una sola categoria e almeno un tag per campo. */
export function organizeGameSettings<T extends TaggableSetting & { tags: GameSettingTagId[] }>(
  sourceCategories: ReadonlyArray<{ id: string; fields: T[] }>,
): OrganizedGameSettingCategory<T>[] {
  const fieldsByCategory = new Map<string, T[]>(CATEGORY_DEFINITIONS.map(({ id }) => [id, []]));

  for (const source of sourceCategories) {
    for (const field of source.fields) {
      const categoryId = categoryIdFor(field, source.id);
      const category = CATEGORY_DEFINITIONS.find(({ id }) => id === categoryId);
      if (!category) throw new Error(`Categoria editor sconosciuta: ${categoryId}`);
      const tags = Array.from(new Set<GameSettingTagId>([category.primaryTag, ...field.tags]));
      fieldsByCategory.get(category.id)?.push({ ...field, tags });
    }
  }

  return CATEGORY_DEFINITIONS
    .map(({ primaryTag: _primaryTag, ...category }) => ({
      ...category,
      fields: fieldsByCategory.get(category.id) ?? [],
    }))
    .filter((category) => category.fields.length > 0);
}
