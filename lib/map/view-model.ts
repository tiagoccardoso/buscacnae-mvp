import { boundsContain } from "@/lib/map/geo";
import type { GeoBounds, MapCompany } from "@/lib/map/types";
import type { ColorBin } from "@/lib/map/intelligence/color-scale";
import type { MapLegend } from "@/lib/map/engine-contract";

/**
 * Cálculos de viewport compartilhados pelos motores 2D e 3D (sem DOM, testáveis).
 */
export const ACCESSIBLE_LIST_LIMIT = 50;

/** Retângulo das posições de desenho, com folga proporcional (e mínima). */
export function computeDataBounds(companies: readonly MapCompany[], paddingRatio = 0.12): GeoBounds | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  let count = 0;
  for (const company of companies) {
    const location = company.location;
    if (!location) continue;
    count += 1;
    west = Math.min(west, location.displayLongitude);
    east = Math.max(east, location.displayLongitude);
    south = Math.min(south, location.displayLatitude);
    north = Math.max(north, location.displayLatitude);
  }
  if (count === 0) return null;
  const pad = Math.max((east - west) * paddingRatio, (north - south) * paddingRatio, 0.05);
  return {
    west: Math.max(-180, west - pad),
    east: Math.min(180, east + pad),
    south: Math.max(-85, south - pad),
    north: Math.min(85, north + pad)
  };
}

/** Quantidade de empresas na área visível + primeiras N (lista acessível). */
export function visibleCompanies(companies: readonly MapCompany[], bounds: GeoBounds, limit = ACCESSIBLE_LIST_LIMIT) {
  const ids: string[] = [];
  let count = 0;
  for (const company of companies) {
    const location = company.location;
    if (!location || !boundsContain(bounds, location.displayLatitude, location.displayLongitude)) continue;
    count += 1;
    if (ids.length < limit) ids.push(company.id);
  }
  return { count, ids };
}

/** Expande o retângulo (fração da largura/altura) para pré-carregar a borda da tela. */
export function padBounds(bounds: GeoBounds, ratio: number): GeoBounds {
  const lng = (bounds.east - bounds.west) * ratio;
  const lat = (bounds.north - bounds.south) * ratio;
  return {
    west: Math.max(-180, bounds.west - lng),
    east: Math.min(180, bounds.east + lng),
    south: Math.max(-85, bounds.south - lat),
    north: Math.min(85, bounds.north + lat)
  };
}

export function rgbaToCss([r, g, b, a]: readonly number[]) {
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
}

export function legendFromBins(title: string, bins: readonly ColorBin[], note: string | null): MapLegend | null {
  if (bins.length === 0) return null;
  return { title, note, bins: bins.map((bin) => ({ min: bin.min, max: bin.max, color: rgbaToCss(bin.color) })) };
}
