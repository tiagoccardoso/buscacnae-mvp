import { cellArea, cellToBoundary, cellToLatLng, getResolution, latLngToCell, UNITS } from "h3-js";
import { boundsContain } from "@/lib/map/geo";
import type { GeoBounds, MapCompany, MapPrecisionStats } from "@/lib/map/types";

/**
 * Inteligência territorial com H3 (Uber H3, Apache-2.0 — pacote h3-js).
 *
 * Cada empresa é atribuída à célula H3 da sua coordenada REAL (latitude/longitude),
 * nunca à posição espalhada usada só para desenhar marcadores. A resolução segue o
 * zoom, mas é limitada pela precisão dos dados: com empresas localizadas pela sede do
 * município, células menores que um município dariam falsa impressão de endereço.
 */
export const H3_MIN_RESOLUTION = 3;
export const H3_MAX_RESOLUTION = 9;

/** Zoom (mapa web) → resolução H3 (células com ~20–60 px na tela). */
export function resolutionForZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return H3_MIN_RESOLUTION;
  if (zoom < 4.5) return 3; // ~12.400 km²
  if (zoom < 6) return 4; // ~1.770 km²
  if (zoom < 7.5) return 5; // ~253 km²
  if (zoom < 9) return 6; // ~36 km²
  if (zoom < 10.5) return 7; // ~5,2 km²
  if (zoom < 12) return 8; // ~0,74 km²
  return 9; // ~0,1 km²
}

/**
 * Resolução máxima honesta para a precisão predominante dos dados:
 * - ≥ 80% com ponto (exata/endereço) → 9;
 * - ≥ 80% com CEP ou melhor          → 8;
 * - caso contrário (município/UF)    → 6 (~36 km², escala municipal).
 */
export function maxResolutionForPrecision(precision: MapPrecisionStats) {
  const total = precision.exact + precision.address + precision.postal_code + precision.city + precision.approximate;
  if (total === 0) return 6;
  const point = precision.exact + precision.address;
  if (point / total >= 0.8) return 9;
  if ((point + precision.postal_code) / total >= 0.8) return 8;
  return 6;
}

export type H3Cell = {
  id: string;
  resolution: number;
  count: number;
  /** Empresas da célula com localização aproximada (CEP, município ou UF). */
  approximate: number;
  companyIds: string[];
  latitude: number;
  longitude: number;
  /** Contorno [lng, lat] (GeoJSON), fechado. */
  polygon: Array<[number, number]>;
  areaKm2: number;
};

export function aggregateCompaniesByH3(companies: readonly MapCompany[], resolution: number): H3Cell[] {
  const cells = new Map<string, { count: number; approximate: number; companyIds: string[] }>();
  for (const company of companies) {
    const location = company.location;
    if (!location) continue;
    let id: string;
    try {
      id = latLngToCell(location.latitude, location.longitude, resolution);
    } catch {
      continue;
    }
    const approximate = location.precision === "exact" || location.precision === "address" ? 0 : 1;
    const cell = cells.get(id);
    if (cell) {
      cell.count += 1;
      cell.approximate += approximate;
      cell.companyIds.push(company.id);
    } else {
      cells.set(id, { count: 1, approximate, companyIds: [company.id] });
    }
  }

  const result: H3Cell[] = [];
  for (const [id, cell] of cells) {
    const [latitude, longitude] = cellToLatLng(id);
    result.push({
      id,
      resolution,
      count: cell.count,
      approximate: cell.approximate,
      companyIds: cell.companyIds,
      latitude,
      longitude,
      polygon: cellToBoundary(id, true) as Array<[number, number]>,
      areaKm2: cellArea(id, UNITS.km2)
    });
  }
  return result.sort((left, right) => right.count - left.count);
}

export function cellsInBounds(cells: readonly H3Cell[], bounds: GeoBounds) {
  return cells.filter((cell) => boundsContain(bounds, cell.latitude, cell.longitude));
}

export function describeCellArea(areaKm2: number) {
  const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: areaKm2 < 10 ? 1 : 0 });
  return `${format.format(areaKm2)} km²`;
}

export function resolutionOf(cellId: string) {
  try {
    return getResolution(cellId);
  } catch {
    return null;
  }
}
