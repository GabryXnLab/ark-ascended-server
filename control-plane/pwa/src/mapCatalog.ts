// Catalogo mappe preimpostate per il form "Nuova configurazione". Elenco statico,
// disponibile a prescindere dallo stato di accensione del server.
//
// Mappe ufficiali: roster confermato per ARK: Survival Ascended (verificato luglio 2026).
// Crystal Isles, Genesis: Part 2, Lost Island e Fjordur non sono ancora stati
// portati su ASA e non compaiono in elenco.
//
// Le mod-mappa si inseriscono come "Mappa personalizzata (WP)" più il loro ModID. Il
// deployment corrente usa il DLC ufficiale Astraeos, non la vecchia mod gratuita
// CurseForge 988598.

import {
  Palmtree, Waves, Sun, Mountain, Radiation, Zap, Trees, Orbit, Ghost, Landmark,
  type LucideIcon,
} from "lucide-react";

export interface MapPreset {
  id: string;
  name: string;
  map: string;
  icon: LucideIcon;
  accent: string;
  description: string;
  mods?: number[];
  source?: string;
  /**
   * URL remoto (hotlink, mai scaricato/committato) di un'immagine ufficiale
   * rappresentativa della mappa — key-art/capsule Steam del DLC ASA corrispondente.
   * Se assente o se il caricamento fallisce a runtime, MapPicker ricade su
   * `icon`+`accent`. Vedi mapCatalog.ts (commento in testa al file) per fonte
   * e affidabilità di ciascun URL.
   */
  previewImageUrl?: string;
}

export const OFFICIAL_MAPS: MapPreset[] = [
  {
    id: "the-island", name: "The Island", map: "TheIsland_WP", icon: Palmtree, accent: "#b8b8b8",
    description: "Mappa base, punto di partenza classico.",
    // Steam header art di ARK: Survival Ascended (gioco base, appid 2399830) — CDN legacy stabile.
    previewImageUrl: "https://cdn.akamai.steamstatic.com/steam/apps/2399830/header.jpg",
  },
  {
    id: "the-center", name: "The Center", map: "TheCenter_WP", icon: Waves, accent: "#d0d0d0",
    description: "Isola centrale con laghi e caverne di cristallo.",
    // Steam header art di "ARK: The Center Ascended" (appid 2827030).
    previewImageUrl: "https://cdn.akamai.steamstatic.com/steam/apps/2827030/header.jpg",
  },
  {
    id: "scorched-earth", name: "Scorched Earth", map: "ScorchedEarth_WP", icon: Sun, accent: "#a0a0a0",
    description: "Deserto arido, tempeste di sabbia.",
    // Steam header art di "ARK: Scorched Earth Ascended" (appid 2849450).
    previewImageUrl: "https://cdn.akamai.steamstatic.com/steam/apps/2849450/header.jpg",
  },
  {
    id: "ragnarok", name: "Ragnarok", map: "Ragnarok_WP", icon: Mountain, accent: "#c4c4c4",
    description: "Vulcani, neve e giungla su una mappa vastissima.",
    // Steam capsule art di "ARK: Ragnarok Ascended" (appid 3675020) — CDN nuova (store_item_assets,
    // URL con hash del contenuto): meno longeva del pattern legacy /steam/apps/<id>/header.jpg,
    // si rompe se Valve rigenera l'asset. Fallback icona/colore già gestito in MapPicker.
    previewImageUrl: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3675020/1c12ea469f34d259faf056995427b2b047bfe00f/capsule_616x353.jpg",
  },
  {
    id: "aberration", name: "Aberration", map: "Aberration_WP", icon: Radiation, accent: "#949494",
    description: "Caverne radioattive, nessun volo diretto.",
    // Steam header art di "ARK: Aberration Ascended" (appid 3059650).
    previewImageUrl: "https://cdn.akamai.steamstatic.com/steam/apps/3059650/header.jpg",
  },
  {
    id: "extinction", name: "Extinction", map: "Extinction_WP", icon: Zap, accent: "#d8d8d8",
    description: "Terra devastata dagli Elementali, ondate di corrotti.",
    // Steam header art di "ARK: Extinction Ascended" (appid 3349320).
    previewImageUrl: "https://cdn.akamai.steamstatic.com/steam/apps/3349320/header.jpg",
  },
  {
    id: "valguero", name: "Valguero", map: "Valguero_WP", icon: Trees, accent: "#acacac",
    description: "Multi-bioma con zona Aberration e grotte.",
    // Steam capsule art di "ARK: Valguero Ascended" (appid 3982310) — CDN nuova con hash, vedi nota Ragnarok.
    previewImageUrl: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3982310/d0914170ff9758af1f8965efe7b9ce59ddeebd62/capsule_616x353.jpg",
  },
  {
    id: "astraeos", name: "Astraeos", map: "Astraeos_WP", icon: Landmark, accent: "#eeeeee",
    description: "DLC ufficiale a pagamento a tema greco; i client devono possederlo sulla propria piattaforma.",
    source: "https://store.steampowered.com/app/3483400/ARK__Astraeos/",
    previewImageUrl: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3483400/header.jpg",
  },
  {
    id: "genesis-1", name: "Genesis: Part 1", map: "Genesis_WP", icon: Orbit, accent: "#bababa",
    description: "Simulazioni biomatiche a bordo della Genesis.",
    // Steam capsule art di "ARK: Genesis Ascended Part 1" (appid 4558470) — CDN nuova con hash, vedi nota Ragnarok.
    previewImageUrl: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4558470/3f199aec93197be8a1f649eeb4678d28d467edd2/capsule_616x353.jpg",
  },
  {
    id: "lost-colony", name: "Lost Colony", map: "LostColony_WP", icon: Ghost, accent: "#888888",
    description: "Era Necrocene: biomi nuovi e sistema Thrall.",
    // Steam capsule art di "ARK: Lost Colony" (appid 3583650) — CDN nuova con hash, vedi nota Ragnarok.
    previewImageUrl: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3583650/c04fc038e81af42d62e055cd6ff15e6ce6d68428/capsule_616x353.jpg",
  },
];
