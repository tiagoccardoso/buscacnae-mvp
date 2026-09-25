import { findMunicipality, findStateCentroid } from "@/lib/geo/municipalities";
import { isFiniteCoordinate, isWithinBrazil, parseCoordinate, spreadPosition } from "@/lib/map/geo";
import type { CompanyLocation, LocationPrecision, LocationSource } from "@/lib/map/types";
import { normalizeCep as normalizeCepValue } from "@/lib/data-quality/normalize";

/**
 * Estratégia de localização (ordem de preferência):
 *
 * 1. coordenada confiável já existente: coordenadas do próprio endereço na fonte
 *    (hoje a Casa dos Dados não as envia; se enviar, entram aqui)             → address;
 * 2. cache por empresa (tabela establishment_locations): coordenadas já
 *    verificadas (exact) ou geocodificadas a partir do endereço (address)      → exact | address;
 * 3. endereço geocodificado: só alimenta o cache do passo 2 (não há geocodificador
 *    de endereço ligado por padrão — ver docs/MAPA_EMPRESARIAL.md);
 * 4. cache interno de CEP (tabela postal_code_locations)                      → postal_code;
 * 5. coordenadas IBGE do município devolvidas pela Casa dos Dados
 *    (endereco.ibge.latitude/longitude)                                        → city;
 *    sede do município pelo código IBGE / nome + UF (base local)               → city;
 * 6. centro da UF                                                              → approximate.
 *
 * Nenhuma chamada externa acontece aqui. A geocodificação de CEP é feita à parte,
 * de forma controlada (lib/geo/postal-code-geocoder.ts), e só alimenta o cache.
 */
export type LocationInput = {
  cnpj: string;
  cep?: string | null;
  cityIbge?: string | null;
  cityName?: string | null;
  stateCode?: string | null;
  payload?: unknown;
};

export type PostalCodeLookup = (cep: string) => { latitude: number; longitude: number } | null;

/** Coordenada por empresa já conhecida (cache). Só aceita precisões de ponto. */
export type CompanyLocationLookup = (
  cnpj: string
) => { latitude: number; longitude: number; precision: "exact" | "address" } | null;

type Coordinates = { latitude: number; longitude: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readPair(record: Record<string, unknown> | null): Coordinates | null {
  if (!record) return null;
  const latitude = parseCoordinate(record.latitude ?? record.lat);
  const longitude = parseCoordinate(record.longitude ?? record.lng ?? record.lon);
  if (latitude === null || longitude === null) return null;
  if (!isFiniteCoordinate(latitude, longitude) || !isWithinBrazil(latitude, longitude)) return null;
  return { latitude, longitude };
}

/** Procura coordenadas no payload da Casa dos Dados, distinguindo endereço de município. */
export function extractProviderCoordinates(payload: unknown) {
  let address: Coordinates | null = null;
  let municipality: Coordinates | null = null;

  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || (address && municipality)) return;
    const record = asRecord(value);
    if (!record) return;

    const endereco = asRecord(record.endereco);
    if (endereco) {
      address ??= readPair(endereco) ?? readPair(asRecord(endereco.coordenadas)) ?? readPair(asRecord(endereco.geolocalizacao));
      municipality ??= readPair(asRecord(endereco.ibge));
    }

    for (const key of ["casadosdados_detalhe", "casadosdados_pesquisa", "data", "estabelecimento", "pesquisa"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  };

  visit(payload, 0);
  return { address, municipality };
}

/** Regra única de CEP (lib/data-quality): 8 dígitos, zero à esquerda recuperado, "00000000" inválido. */
export function normalizeCep(value: string | null | undefined) {
  return normalizeCepValue(value);
}

function build(input: LocationInput, coordinates: Coordinates, precision: LocationPrecision, source: LocationSource): CompanyLocation {
  return {
    cnpj: input.cnpj,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    precision,
    source,
    displayLatitude: coordinates.latitude,
    displayLongitude: coordinates.longitude
  };
}

export function resolveCompanyLocation(
  input: LocationInput,
  lookupPostalCode?: PostalCodeLookup,
  lookupCompanyLocation?: CompanyLocationLookup
): CompanyLocation | null {
  const provider = extractProviderCoordinates(input.payload);
  if (provider.address) return build(input, provider.address, "address", "provider");

  if (lookupCompanyLocation && input.cnpj) {
    const cached = lookupCompanyLocation(input.cnpj);
    if (
      cached &&
      (cached.precision === "exact" || cached.precision === "address") &&
      isFiniteCoordinate(cached.latitude, cached.longitude) &&
      isWithinBrazil(cached.latitude, cached.longitude)
    ) {
      return build(input, cached, cached.precision, "company_cache");
    }
  }

  const cep = normalizeCep(input.cep);
  if (cep && lookupPostalCode) {
    const cached = lookupPostalCode(cep);
    if (cached && isFiniteCoordinate(cached.latitude, cached.longitude)) {
      return build(input, cached, "postal_code", "postal_code_cache");
    }
  }

  if (provider.municipality) return build(input, provider.municipality, "city", "provider_municipality");

  const municipality = findMunicipality({ ibge: input.cityIbge, name: input.cityName, stateCode: input.stateCode });
  if (municipality) {
    return build(input, { latitude: municipality.latitude, longitude: municipality.longitude }, "city", "municipality_centroid");
  }

  const state = findStateCentroid(input.stateCode);
  if (state) return build(input, { latitude: state.latitude, longitude: state.longitude }, "approximate", "state_centroid");

  return null;
}

/**
 * Distribui visualmente empresas que caíram exatamente no mesmo ponto agregado
 * (mesmo CEP, município ou UF). A coordenada original é preservada.
 */
export function spreadSharedLocations<T extends { location: CompanyLocation | null }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const location = item.location;
    if (!location || location.precision === "exact" || location.precision === "address") continue;
    const key = `${location.precision}|${location.latitude.toFixed(5)}|${location.longitude.toFixed(5)}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((left, right) => left.location!.cnpj.localeCompare(right.location!.cnpj));
    ordered.forEach((item, index) => {
      const location = item.location!;
      const spread = spreadPosition(location.latitude, location.longitude, location.precision, index, ordered.length, location.cnpj);
      location.displayLatitude = spread.latitude;
      location.displayLongitude = spread.longitude;
    });
  }

  return items;
}
