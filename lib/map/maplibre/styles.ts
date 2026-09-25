import type { StyleSpecification } from "maplibre-gl";
import type { BasemapId, PublicMapConfig } from "@/lib/map/config";

/**
 * Mapas base do motor 2D (MapLibre).
 *
 * Mesmo catálogo do 3D (NEXT_PUBLIC_MAP_BASEMAP), em estilo raster: não depende de
 * glyphs/sprites externos, carrega rápido e funciona com qualquer servidor XYZ.
 * Quem tiver um estilo vetorial (MapTiler, Stadia, OpenFreeMap, servidor próprio)
 * define NEXT_PUBLIC_MAP_STYLE_URL e ele substitui o catálogo no 2D.
 *
 * Mesmo sem tiles (offline, bloqueio de rede, cota), o fundo do estilo continua
 * visível e as camadas de empresas/H3/regiões seguem funcionando por cima.
 */
export type ResolvedBasemap = {
  id: BasemapId | "custom";
  style: StyleSpecification | string;
  /** Estilo raster do catálogo: o tema claro/escuro é aplicado por paint properties. */
  themeable: boolean;
};

const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`;

export const BASEMAP_BACKGROUND = { light: "#e9eef3", dark: "#1c1c1e" } as const;

function rasterStyle(tiles: string[], attribution: string, theme: "light" | "dark", maxzoom = 19): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: { type: "raster", tiles, tileSize: 256, attribution, maxzoom }
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": BASEMAP_BACKGROUND[theme] } },
      { id: "basemap", type: "raster", source: "basemap", paint: rasterPaint(theme, false) }
    ]
  };
}

function offlineStyle(theme: "light" | "dark"): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": BASEMAP_BACKGROUND[theme] } }]
  };
}

/** Escurece tiles claros no tema escuro (mesma ideia do ajuste de brilho do 3D). */
export function rasterPaint(theme: "light" | "dark", alreadyDark: boolean) {
  const dim = theme === "dark" && !alreadyDark;
  return {
    "raster-saturation": dim ? -0.75 : -0.35,
    "raster-brightness-max": dim ? 0.5 : 1,
    "raster-brightness-min": 0,
    "raster-contrast": dim ? 0.15 : 0,
    "raster-fade-duration": 120
  };
}

function cartoTiles(variant: "light_all" | "dark_all", retina: boolean) {
  const suffix = retina ? "@2x" : "";
  return ["a", "b", "c", "d"].map((sub) => `https://${sub}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}${suffix}.png`);
}

export function resolveBasemap(config: PublicMapConfig, theme: "light" | "dark", retina = false): ResolvedBasemap {
  if (config.styleUrl) return { id: "custom", style: config.styleUrl, themeable: false };

  switch (config.basemap) {
    case "carto-light":
    case "carto-dark": {
      // O CARTO tem as duas variantes: seguimos o tema do sistema (claro ↔ escuro).
      const variant = theme === "dark" ? "dark_all" : "light_all";
      return { id: config.basemap, style: rasterStyle(cartoTiles(variant, retina), CARTO_ATTRIBUTION, theme, 20), themeable: false };
    }
    case "offline":
      return { id: "offline", style: offlineStyle(theme), themeable: false };
    case "ion":
    // Cesium ion é exclusivo do 3D; no 2D usamos o OSM (sem chave).
    // falls through
    case "osm":
    default:
      return { id: "osm", style: rasterStyle(["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], OSM_ATTRIBUTION, theme), themeable: true };
  }
}

export function fallbackBasemap(theme: "light" | "dark"): ResolvedBasemap {
  return { id: "offline", style: offlineStyle(theme), themeable: false };
}

export const MAPLIBRE_LOCALE_PT_BR: Record<string, string> = {
  "AttributionControl.ToggleAttribution": "Mostrar/ocultar atribuições",
  "AttributionControl.MapFeedback": "Sugerir correção no mapa",
  "Map.Title": "Mapa",
  "NavigationControl.ZoomIn": "Aproximar",
  "NavigationControl.ZoomOut": "Afastar",
  "NavigationControl.ResetBearing": "Apontar para o norte",
  "ScaleControl.Meters": "m",
  "ScaleControl.Kilometers": "km",
  "CooperativeGesturesHandler.WindowsHelpText": "Use Ctrl + rolagem para aproximar o mapa",
  "CooperativeGesturesHandler.MacHelpText": "Use ⌘ + rolagem para aproximar o mapa",
  "CooperativeGesturesHandler.MobileHelpText": "Use dois dedos para mover o mapa"
};
