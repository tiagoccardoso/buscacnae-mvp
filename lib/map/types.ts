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
  saved: boolean;
  location: CompanyLocation | null;
};

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
