/**
 * Configuração PÚBLICA do mapa (lida no servidor em tempo de execução e enviada ao
 * navegador como props). Só entram valores que podem ser expostos.
 */
export type BasemapId = "osm" | "carto-light" | "carto-dark" | "ion" | "offline";

export const BASEMAP_IDS: readonly BasemapId[] = ["osm", "carto-light", "carto-dark", "ion", "offline"];

export type PublicMapConfig = {
  /** Mapa base (2D e 3D). */
  basemap: BasemapId;
  /**
   * Estilo MapLibre próprio (opcional, 2D). Ex.: MapTiler, Stadia, OpenFreeMap ou um
   * servidor de tiles próprio. Quando definido, substitui `basemap` no 2D.
   */
  styleUrl: string;
  /** Opcionais (3D/Cesium). São chaves de navegador: restrinja por domínio. */
  cesiumIonToken: string;
  googleMapTilesKey: string;
};

export const DEFAULT_PUBLIC_MAP_CONFIG: PublicMapConfig = {
  basemap: "osm",
  styleUrl: "",
  cesiumIonToken: "",
  googleMapTilesKey: ""
};

/** Aceita somente http(s) absoluto ou caminho do próprio domínio. */
export function sanitizeStyleUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}
