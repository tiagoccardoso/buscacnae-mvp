import type { ViewScale } from "@/lib/map/geo";
import type { PublicMapConfig } from "@/lib/map/config";
import type { GeoBounds, MapCompany, MapEngineKind, MapLayerMode, MapRegionSeat, MapRegionSelection } from "@/lib/map/types";

/**
 * Contrato comum dos motores do Mapa Empresarial.
 *
 * - 2D operacional: MapLibre GL + deck.gl (lib/map/maplibre/*) — padrão, leve, sempre disponível.
 * - 3D opcional: CesiumJS (lib/map/cesium/*) — carregado só quando o usuário pede o globo.
 *
 * Os componentes React só conversam com esta interface: o motor é criado uma vez por
 * montagem e recebe dados, camada, seleção e câmera por métodos (sem recriar o mapa e
 * sem um componente React por empresa).
 */
/** Legenda das camadas agregadas (classes por quantil). */
export type MapLegend = {
  title: string;
  bins: Array<{ min: number; max: number; color: string }>;
  /** Aviso sobre a leitura da camada (ex.: resolução limitada pela precisão dos dados). */
  note: string | null;
};

export type MapViewInfo = {
  bounds: GeoBounds;
  /** Zoom equivalente de mapas web (0 = mundo, ~20 = rua). */
  zoom: number;
  scale: ViewScale;
  visibleCompanyCount: number;
  /** Primeiras empresas na área visível (alternativa textual acessível ao mapa). */
  visibleCompanyIds: string[];
  clusterCount: number;
  /** Resolução H3 em uso na camada Concentração (null nas outras camadas). */
  h3Resolution: number | null;
  legend: MapLegend | null;
};

export type MapEngineCallbacks = {
  onSelect(companyId: string | null): void;
  onViewChange(info: MapViewInfo): void;
  /** Cluster que não se separa com zoom (empresas no mesmo ponto). */
  onGroupSelect(companyIds: string[]): void;
  /** Célula H3 ou município selecionado (camadas Concentração/Regiões). */
  onRegionSelect(region: MapRegionSelection | null): void;
  /** Primeira interação do usuário com a câmera (não conta enquadramentos automáticos). */
  onUserMove?(): void;
};

export type MapEngineOptions = MapEngineCallbacks & {
  container: HTMLElement;
  creditContainer: HTMLElement;
  config: PublicMapConfig;
  /** Área inicial (ex.: a área que o usuário via no outro motor). */
  initialBounds?: GeoBounds | null;
};

export type MapEngineCapabilities = {
  kind: MapEngineKind;
  modes: readonly MapLayerMode[];
  photorealistic: boolean;
};

export type BusinessMapEngine = {
  readonly capabilities: MapEngineCapabilities;
  setData(data: { companies: MapCompany[]; regions: MapRegionSeat[] }, options?: { fit?: boolean }): void;
  setMode(mode: MapLayerMode): void;
  setSelected(companyId: string | null): void;
  setSelectedRegion(regionId: string | null): void;
  focusCompany(companyId: string): void;
  focusPoint(latitude: number, longitude: number, zoom: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  fitToData(): void;
  setPhotorealistic(enabled: boolean): Promise<boolean>;
  getViewBounds(): GeoBounds;
  destroy(): void;
};

export type MapEngineFactory = (options: MapEngineOptions, signal: AbortSignal) => Promise<BusinessMapEngine>;
