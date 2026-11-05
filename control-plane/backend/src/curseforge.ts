// Client verso l'API pubblica di CurseForge, usata per il catalogo mod nella PWA
// (store in-stile "Mod Ascended" per cercare/aggiungere mod ad una mappa).

import { config } from "./config.js";
import { log } from "./logger.js";

const BASE = "https://api.curseforge.com/v1";
// Il nome esatto su CurseForge è "ARK Survival Ascended" (senza ":"); normalizziamo
// per non dipendere dalla punteggiatura esatta usata dal catalogo.
const GAME_NAME_NORMALIZED = "arksurvivalascended";
function normalizeGameName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function cfFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!config.curseforgeApiKey) {
    throw new Error("CURSEFORGE_API_KEY non configurata: vedi .env.example");
  }
  const headers: Record<string, string> = { "x-api-key": config.curseforgeApiKey, accept: "application/json" };
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CurseForge ${path} → ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

interface CfGame {
  id: number;
  name: string;
}

// L'id gioco non è documentato/stabile: lo risolviamo per nome (invece di
// hardcodarlo) e lo teniamo in cache per il resto del processo.
let cachedGameId: number | null = null;

async function resolveGameId(): Promise<number> {
  if (cachedGameId !== null) return cachedGameId;
  const pageSize = 100;
  for (let index = 0; index < 1000; index += pageSize) {
    const { data } = await cfFetch<{ data: CfGame[] }>(`/games?pageSize=${pageSize}&index=${index}`);
    if (data.length === 0) break;
    const game = data.find((g) => normalizeGameName(g.name) === GAME_NAME_NORMALIZED);
    if (game) {
      cachedGameId = game.id;
      return game.id;
    }
  }
  throw new Error("Gioco ARK: Survival Ascended non trovato su CurseForge");
}

export interface ModSearchResult {
  id: number;
  name: string;
  summary: string;
  thumbnailUrl: string | null;
  downloadCount: number;
  websiteUrl: string;
  authors: string[];
  categoryIds: number[];
  dateModified: string | null;
}

export interface ModScreenshot {
  id: number;
  title: string;
  thumbnailUrl: string;
  url: string;
}

export interface ModDetail extends ModSearchResult {
  screenshots: ModScreenshot[];
}

export interface ModCategory {
  id: number;
  name: string;
  slug: string;
  iconUrl: string | null;
  parentCategoryId: number | null;
}

interface CfMod {
  id: number;
  name: string;
  summary: string;
  downloadCount: number;
  dateModified?: string;
  logo: { thumbnailUrl: string } | null;
  links: { websiteUrl: string };
  authors: { name: string }[];
  categories?: { id: number }[];
  screenshots?: { id: number; title: string; thumbnailUrl: string; url: string }[];
  latestFiles?: { id: number; fileName: string; fileDate: string; releaseType?: number }[];
}

export interface ModUpdateVersion {
  id: number;
  version: string | null;
}

/** Identificatore stabile dell'ultimo pacchetto WindowsServer pubblicato. */
export function modUpdateVersion(mod: Pick<CfMod, "id" | "dateModified" | "latestFiles">): ModUpdateVersion {
  const serverFile = [...(mod.latestFiles ?? [])]
    .filter((file) => file.fileName.toLowerCase().includes("windowsserver"))
    .sort((a, b) => b.fileDate.localeCompare(a.fileDate))[0];
  return {
    id: mod.id,
    version: serverFile ? `file:${serverFile.id}:${serverFile.fileDate}` : mod.dateModified ? `mod:${mod.dateModified}` : null,
  };
}

interface CfSearchResponse {
  data: CfMod[];
  pagination: { index: number; pageSize: number; resultCount: number; totalCount: number };
}

function toSearchResult(m: CfMod): ModSearchResult {
  return {
    id: m.id,
    name: m.name,
    summary: m.summary,
    thumbnailUrl: m.logo?.thumbnailUrl ?? null,
    downloadCount: m.downloadCount,
    websiteUrl: m.links?.websiteUrl ?? "",
    authors: m.authors?.map((a) => a.name) ?? [],
    categoryIds: m.categories?.map((c) => c.id) ?? [],
    dateModified: m.dateModified ?? null,
  };
}

export async function searchMods(
  query: string,
  page = 0,
  pageSize = 20,
  categoryId?: number,
): Promise<{ items: ModSearchResult[]; totalCount: number }> {
  const gameId = await resolveGameId();
  const params = new URLSearchParams({
    gameId: String(gameId),
    pageSize: String(pageSize),
    index: String(page * pageSize),
    sortField: "2", // popolarità
    sortOrder: "desc",
  });
  if (query.trim()) params.set("searchFilter", query.trim());
  if (categoryId) params.set("categoryId", String(categoryId));

  const { data, pagination } = await cfFetch<CfSearchResponse>(`/mods/search?${params}`);
  return { items: data.map(toSearchResult), totalCount: pagination.totalCount };
}

export async function getFeaturedMods(): Promise<{
  featured: ModSearchResult[];
  popular: ModSearchResult[];
  recentlyUpdated: ModSearchResult[];
}> {
  const gameId = await resolveGameId();
  const res = await cfFetch<{ data: { featured: CfMod[]; popular: CfMod[]; recentlyUpdated: CfMod[] } }>(
    "/mods/featured",
    { method: "POST", body: { gameId } },
  );
  return {
    featured: res.data.featured.map(toSearchResult),
    popular: res.data.popular.map(toSearchResult),
    recentlyUpdated: res.data.recentlyUpdated.map(toSearchResult),
  };
}

export async function getCategories(): Promise<ModCategory[]> {
  const gameId = await resolveGameId();
  const { data } = await cfFetch<{
    data: { id: number; name: string; slug: string; iconUrl: string | null; parentCategoryId: number | null; isClass?: boolean }[];
  }>(`/categories?gameId=${gameId}`);
  // Le "classi" (es. "Mods") sono nodi radice della tassonomia, non categorie selezionabili.
  return data.filter((c) => !c.isClass).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    iconUrl: c.iconUrl,
    parentCategoryId: c.parentCategoryId ?? null,
  }));
}

export async function getModDetail(id: number): Promise<ModDetail> {
  const { data } = await cfFetch<{ data: CfMod }>(`/mods/${id}`);
  return {
    ...toSearchResult(data),
    screenshots: (data.screenshots ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      thumbnailUrl: s.thumbnailUrl,
      url: s.url,
    })),
  };
}

export async function getModDescription(id: number): Promise<string> {
  const { data } = await cfFetch<{ data: string }>(`/mods/${id}/description`);
  return data;
}

export async function getModsByIds(ids: number[]): Promise<ModSearchResult[]> {
  if (ids.length === 0) return [];
  // Best-effort: un singolo ID non-CurseForge nel batch fa rispondere 400 all'intera
  // chiamata; non deve mai bloccare l'arricchimento degli altri ID validi, quindi qui
  // logghiamo e restituiamo ciò che abbiamo (vuoto se la chiamata è fallita del tutto).
  try {
    const { data } = await cfFetch<{ data: CfMod[] }>("/mods", { method: "POST", body: { modIds: ids } });
    return data.map(toSearchResult);
  } catch (e) {
    log.warn("getModsByIds: batch CurseForge fallito", e);
    return [];
  }
}

/** Manifesto best-effort per l'updater nativo ASA. Gli ID non risolti restano
 * con versione null: l'agent li considera da verificare, mai implicitamente aggiornati. */
export async function getModUpdateManifest(ids: number[]): Promise<ModUpdateVersion[]> {
  if (ids.length === 0) return [];
  try {
    const { data } = await cfFetch<{ data: CfMod[] }>("/mods", { method: "POST", body: { modIds: ids } });
    const byId = new Map(data.map((mod) => [mod.id, modUpdateVersion(mod)]));
    return ids.map((id) => byId.get(id) ?? { id, version: null });
  } catch (e) {
    log.warn("Manifesto aggiornamenti CurseForge non disponibile: ASA verificherà comunque tutti gli ID", e);
    return ids.map((id) => ({ id, version: null }));
  }
}
