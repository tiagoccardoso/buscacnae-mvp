import type { GeoBounds, LocationPrecision } from "@/lib/map/types";

/** Limites aproximados do território brasileiro (visão inicial do mapa). */
export const BRAZIL_BOUNDS: GeoBounds = { west: -74.1, south: -33.9, east: -34.7, north: 5.4 };

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export function isFiniteCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

/** Coordenada plausível para o Brasil (com folga para ilhas oceânicas). */
export function isWithinBrazil(latitude: number, longitude: number) {
  return latitude >= -35 && latitude <= 6 && longitude >= -75 && longitude <= -28;
}

export function parseCoordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeBounds(bounds: GeoBounds): GeoBounds | null {
  const values = [bounds?.west, bounds?.south, bounds?.east, bounds?.north];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const south = Math.max(-90, Math.min(bounds.south, bounds.north));
  const north = Math.min(90, Math.max(bounds.south, bounds.north));
  const west = Math.max(-180, Math.min(180, bounds.west));
  const east = Math.max(-180, Math.min(180, bounds.east));
  if (south === north) return null;
  return { west, south, east, north };
}

/** Suporta retângulos que cruzam o antimeridiano (west > east). */
export function boundsContain(bounds: GeoBounds, latitude: number, longitude: number) {
  if (latitude < bounds.south || latitude > bounds.north) return false;
  if (bounds.west <= bounds.east) return longitude >= bounds.west && longitude <= bounds.east;
  return longitude >= bounds.west || longitude <= bounds.east;
}

export function boundsFromPoints(points: Array<{ latitude: number; longitude: number }>, paddingRatio = 0.08): GeoBounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of points) {
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }
  const minSpan = 0.02;
  const lngPad = Math.max((east - west) * paddingRatio, minSpan);
  const latPad = Math.max((north - south) * paddingRatio, minSpan);
  return normalizeBounds({ west: west - lngPad, east: east + lngPad, south: south - latPad, north: north + latPad });
}

/** Área aproximada em km² (usada para limitar "Buscar nesta área"). */
export function boundsAreaKm2(bounds: GeoBounds) {
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  return latSpan * 111.32 * (lngSpan * 111.32 * Math.cos(midLat));
}

/**
 * Converte a altura da câmera (m) em um nível de zoom equivalente ao de mapas
 * web (0 = mundo, ~20 = rua). Usado pelo índice de clusters.
 */
export function heightToZoom(heightMeters: number) {
  if (!Number.isFinite(heightMeters) || heightMeters <= 0) return 20;
  const zoom = Math.log2(EARTH_CIRCUMFERENCE_M / heightMeters) + 1;
  return Math.max(0, Math.min(20, Math.round(zoom)));
}

export function zoomToHeight(zoom: number) {
  const safeZoom = Math.max(0, Math.min(20, zoom));
  return EARTH_CIRCUMFERENCE_M / 2 ** (safeZoom - 1);
}

export type ViewScale = "pais" | "regional" | "estadual" | "municipal" | "detalhada";

export const VIEW_SCALE_LABELS: Record<ViewScale, string> = {
  pais: "Brasil",
  regional: "Regional",
  estadual: "Estadual",
  municipal: "Municipal",
  detalhada: "Detalhada"
};

export function viewScaleForHeight(heightMeters: number): ViewScale {
  if (heightMeters > 4_500_000) return "pais";
  if (heightMeters > 1_500_000) return "regional";
  if (heightMeters > 250_000) return "estadual";
  if (heightMeters > 25_000) return "municipal";
  return "detalhada";
}

/** Hash determinístico (FNV-1a 32 bits) — mesma posição a cada renderização. */
export function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Raio máximo (m) de distribuição visual por precisão agregada. */
export const SPREAD_RADIUS_METERS: Record<LocationPrecision, number> = {
  exact: 0,
  address: 0,
  postal_code: 250,
  city: 2_500,
  approximate: 25_000
};

/**
 * Distribui visualmente pontos que compartilham a mesma coordenada agregada,
 * em espiral de Fermat (ângulo áureo). O deslocamento é determinístico por CNPJ
 * e cresce com a quantidade de empresas no mesmo ponto, até o raio da precisão.
 */
export function spreadPosition(
  latitude: number,
  longitude: number,
  precision: LocationPrecision,
  indexInGroup: number,
  groupSize: number,
  seed: string
) {
  const maxRadius = SPREAD_RADIUS_METERS[precision];
  if (!maxRadius || groupSize <= 1) return { latitude, longitude };
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const jitter = (stableHash(seed) % 1000) / 1000;
  const slot = indexInGroup + 0.5 + jitter * 0.5;
  const radius = maxRadius * Math.sqrt(slot / Math.max(groupSize, 1));
  const angle = slot * goldenAngle + jitter * Math.PI * 2;
  const dLat = (radius * Math.cos(angle)) / 111_320;
  const dLng = (radius * Math.sin(angle)) / (111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  return { latitude: latitude + dLat, longitude: longitude + dLng };
}
