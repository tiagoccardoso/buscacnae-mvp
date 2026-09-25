/**
 * Tipos compartilhados (servidor + cliente) do Mapa Empresarial.
 * Este arquivo não pode importar nada de Node nem do Cesium.
 */

/**
 * Precisão da coordenada exibida.
 * - exact: coordenada do próprio estabelecimento informada pela fonte;
 * - address: endereço geocodificado (rua/número);
 * - postal_code: centro aproximado do CEP;
 * - city: sede do município (IBGE);
 * - approximate: apenas a UF é conhecida (centro do estado).
 */
export type LocationPrecision = "exact" | "address" | "postal_code" | "city" | "approximate";

export type LocationSource =
  | "provider"
  | "company_cache"
  | "provider_municipality"
  | "postal_code_cache"
  | "postal_code_geocoder"
  | "municipality_centroid"
  | "state_centroid";

export type CompanyLocation = {
  cnpj: string;
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
  source: LocationSource;
  /**
   * Posição usada somente para desenhar o marcador. Para precisões agregadas
   * (CEP, município, UF) várias empresas compartilham o mesmo ponto; elas são
   * distribuídas em um pequeno raio determinístico para não se sobreporem.
   * A coordenada "real" continua em latitude/longitude.
   */
  displayLatitude: number;
  displayLongitude: number;
};

export type GeoBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Resumo empresarial consumido pelo mapa (mesmo modelo da lista, ver lib/company-model.ts). */
export type MapCompany = {
  id: string;
  cnpj: string;
  displayName: string;
  legalName: string;
  tradeName: string | null;
  status: string | null;
  primaryCnaeCode: string | null;
  primaryCnaeDescription: string | null;
  cityName: string | null;
  stateCode: string | null;
  capitalSocial: number | null;
  openedAt: string | null;
  companySize: string | null;
  /** Campos usados pelos filtros compartilhados com a lista (sem expor contatos). */
  headquartersOrBranch: "matriz" | "filial" | null;
  neighborhood: string | null;
  hasPhone: boolean;
  hasMobilePhone: boolean;
  hasEmail: boolean;
  /** Código IBGE do município (base local, por código ou nome + UF); null se não identificado. Camada Regiões. */
  regionKey: string | null;
  saved: boolean;
  location: CompanyLocation | null;
};

/**
 * Município referenciado pelas empresas da busca, com a coordenada da SEDE (IBGE).
 * A camada Regiões desenha um marcador por município nessa coordenada.
 */
export type MapRegionSeat = {
  key: string;
  ibge: string | null;
  name: string;
  stateCode: string;
  latitude: number;
  longitude: number;
};

/**
 * Camadas do mapa.
 * - companies: empresas (clusters + pontos);
 * - concentration: células H3 com contagem de empresas;
 * - regions: agregação por município (sede IBGE).
 */
export type MapLayerMode = "companies" | "concentration" | "regions";

export const MAP_LAYER_LABELS: Record<MapLayerMode, string> = {
  companies: "Empresas",
  concentration: "Concentração",
  regions: "Regiões"
};

/** Nome da camada na URL (?camada=). */
export const MAP_LAYER_PARAM: Record<MapLayerMode, string> = { companies: "empresas", concentration: "concentracao", regions: "regioes" };

export function mapLayerFromParam(value: unknown): MapLayerMode | null {
  if (typeof value !== "string") return null;
  const entry = (Object.entries(MAP_LAYER_PARAM) as Array<[MapLayerMode, string]>).find(([, param]) => param === value);
  return entry ? entry[0] : null;
}

/** Região selecionada no mapa (célula H3 ou município). */
export type MapRegionSelection =
  | { kind: "h3"; id: string; resolution: number; companyIds: string[]; latitude: number; longitude: number }
  | { kind: "municipality"; id: string; name: string; stateCode: string; companyIds: string[]; latitude: number; longitude: number };

export type MapEngineKind = "2d" | "3d";

export type MapPrecisionStats = Record<LocationPrecision, number>;

export type MapSearchData = {
  searchId: string;
  headline: string;
  cnaeText: string;
  locationText: string;
  filterLabels: string[];
  createdAt: string | null;
  /** Total informado pela busca (pode ser maior que os registros carregados). */
  totalResults: number;
  /** Lista liberada para o usuário (pedido pago/gratuito). */
  unlocked: boolean;
  /** Registros ocultos até a compra (o mapa segue a mesma regra da lista). */
  lockedCount: number;
  companies: MapCompany[];
  stats: {
    loaded: number;
    withLocation: number;
    withoutLocation: number;
    byPrecision: MapPrecisionStats;
  };
  limits: {
    maxMarkers: number;
    truncated: boolean;
    tooManyResults: boolean;
  };
  bounds: GeoBounds | null;
  /** Sedes dos municípios presentes no resultado (camada Regiões). */
  regions: MapRegionSeat[];
  geocoding: {
    enabled: boolean;
    pendingPostalCodes: number;
  };
};

export type MapSearchOption = {
  id: string;
  headline: string;
  createdAt: string | null;
  totalResults: number;
};

export type AreaSearchRequest = {
  searchId: string;
  bounds: GeoBounds;
};

export type AreaSearchResponse =
  | { ok: true; searchId: string; cities: number }
  | { ok: false; reason: "too_large" | "empty" | "invalid" | "error"; message: string };

export const PRECISION_LABELS: Record<LocationPrecision, string> = {
  exact: "Localização exata",
  address: "Endereço",
  postal_code: "Região do CEP",
  city: "Centro do município",
  approximate: "Aproximada (estado)"
};

/** Precisões que podem ser apresentadas como ponto do estabelecimento. */
export function isPreciseLocation(precision: LocationPrecision) {
  return precision === "exact" || precision === "address";
}
