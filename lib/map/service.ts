import { createDbClient } from "@/lib/db-client";
import { getLatestSearchAccessOrderBySearchQueryId } from "@/lib/billing";
import { companySummaryFromSearchRow, type CompanySummary } from "@/lib/company-model";
import { normalizeCep, resolveCompanyLocation, spreadSharedLocations, type CompanyLocationLookup } from "@/lib/geo/company-location";
import { loadCompanyLocationCache, type CachedCompanyLocation } from "@/lib/geo/company-location-cache";
import { findMunicipality } from "@/lib/geo/municipalities";
import { resolvePostalCodes, type PostalCodeResolution } from "@/lib/geo/postal-code-geocoder";
import { getMapMaxMarkers } from "@/lib/env";
import { boundsFromPoints } from "@/lib/map/geo";
import type { LocationPrecision, MapCompany, MapRegionSeat, MapSearchData, MapSearchOption } from "@/lib/map/types";
import { getSearchSummary } from "@/lib/search-summary";

/**
 * Dados do Mapa Empresarial para uma busca já salva.
 *
 * O mapa NÃO consulta a Casa dos Dados: ele lê exatamente as linhas que a busca
 * (prepareSearchOrder → Casa dos Dados) gravou em search_results/establishments,
 * com as mesmas regras de liberação da lista (amostra de 1 registro antes da compra).
 */
export class MapSearchNotFoundError extends Error {
  constructor() {
    super("Busca não encontrada.");
    this.name = "MapSearchNotFoundError";
  }
}

const UNLOCKED_STATUSES = new Set(["paid", "free"]);

function emptyPrecisionStats(): Record<LocationPrecision, number> {
  return { exact: 0, address: 0, postal_code: 0, city: 0, approximate: 0 };
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Chave canônica do município = código IBGE, resolvido pela base local (por código ou
 * por nome + UF). Assim "3509502" e "CAMPINAS/SP" caem na MESMA região. Município que
 * não existe na base → null (fica fora da camada Regiões, continua na lista).
 */
export function municipalityKey(input: { cityIbge?: string | null; cityName?: string | null; stateCode?: string | null }) {
  return findMunicipality({ ibge: input.cityIbge, name: input.cityName, stateCode: input.stateCode })?.ibge ?? null;
}

/**
 * Sedes (IBGE) dos municípios presentes no resultado. Usa a base local de municípios;
 * município não identificado na base fica fora da camada Regiões (continua na lista).
 */
export function buildRegionSeats(summaries: CompanySummary[]): MapRegionSeat[] {
  const seats = new Map<string, MapRegionSeat>();
  for (const summary of summaries) {
    const municipality = findMunicipality({ ibge: summary.cityIbge, name: summary.cityName, stateCode: summary.stateCode });
    if (!municipality || seats.has(municipality.ibge)) continue;
    seats.set(municipality.ibge, {
      key: municipality.ibge,
      ibge: municipality.ibge,
      name: municipality.name,
      stateCode: municipality.stateCode,
      latitude: municipality.latitude,
      longitude: municipality.longitude
    });
  }
  return Array.from(seats.values());
}

/** Monta os marcadores a partir dos resumos (função pura, testável). */
export function buildMapCompanies(
  summaries: CompanySummary[],
  savedIds: Set<string>,
  postalCodes: Map<string, { latitude: number; longitude: number }>,
  companyLocations: Map<string, CachedCompanyLocation> = new Map()
): MapCompany[] {
  const lookupCompany: CompanyLocationLookup = (cnpj) => companyLocations.get(cnpj) ?? null;
  const companies = summaries.map<MapCompany>((summary) => ({
    id: summary.id,
    cnpj: summary.cnpj,
    displayName: summary.displayName,
    legalName: summary.legalName,
    tradeName: summary.tradeName,
    status: summary.status,
    primaryCnaeCode: summary.primaryCnaeCode,
    primaryCnaeDescription: summary.primaryCnaeDescription,
    cityName: summary.cityName,
    stateCode: summary.stateCode,
    capitalSocial: summary.capitalSocial,
    openedAt: summary.openedAt,
    companySize: summary.companySize,
    headquartersOrBranch: summary.headquartersOrBranch ?? null,
    neighborhood: summary.neighborhood ?? null,
    hasPhone: Boolean(summary.phone),
    hasMobilePhone: Boolean(summary.phone && summary.phoneIsMobile),
    hasEmail: Boolean(summary.email),
    regionKey: municipalityKey(summary),
    saved: savedIds.has(summary.id),
    location: summary.cnpj
      ? resolveCompanyLocation(
          {
            cnpj: summary.cnpj,
            cep: summary.postalCode,
            cityIbge: summary.cityIbge,
            cityName: summary.cityName,
            stateCode: summary.stateCode,
            payload: summary.payload
          },
          (cep) => postalCodes.get(cep) ?? null,
          lookupCompany
        )
      : null
  }));

  return spreadSharedLocations(companies);
}

export function summarizeMapCompanies(companies: MapCompany[]) {
  const byPrecision = emptyPrecisionStats();
  let withLocation = 0;
  for (const company of companies) {
    if (!company.location) continue;
    withLocation += 1;
    byPrecision[company.location.precision] += 1;
  }
  return {
    loaded: companies.length,
    withLocation,
    withoutLocation: companies.length - withLocation,
    byPrecision
  };
}

export async function listMapSearchOptions(profileId: string, limit = 20): Promise<MapSearchOption[]> {
  const db = createDbClient();
  const { data } = await db
    .from("search_queries")
    .select("id, cnae_code, city_name, state_code, query_payload, total_results, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    headline: getSearchSummary(row).headline,
    createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at instanceof Date ? row.created_at.toISOString() : null,
    totalResults: Math.max(0, Number(row.total_results ?? 0) || 0)
  }));
}

export async function getSearchMapData(
  searchId: string,
  profileId: string,
  options: { resolvePostal?: (ceps: string[]) => Promise<PostalCodeResolution> } = {}
): Promise<MapSearchData> {
  if (!isUuid(searchId)) throw new MapSearchNotFoundError();

  const db = createDbClient();
  const { data: search } = await db
    .from("search_queries")
    .select("*")
    .eq("id", searchId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!search) throw new MapSearchNotFoundError();

  const summary = getSearchSummary(search);
  const queryPayload =
    search.query_payload && typeof search.query_payload === "object" && !Array.isArray(search.query_payload)
      ? (search.query_payload as Record<string, unknown>)
      : {};

  const order = await getLatestSearchAccessOrderBySearchQueryId(searchId);
  const unlocked = Boolean(order && UNLOCKED_STATUSES.has(String(order.status)));
  const maxMarkers = getMapMaxMarkers();

  const { data: rows } = await db
    .from("search_results")
    .select("position, establishment_id, provider_payload, establishments(*)")
    .eq("search_query_id", searchId)
    .order("position", { ascending: true })
    .limit(unlocked ? maxMarkers + 1 : 1);

  const loadedRows = (rows ?? []) as Array<Record<string, unknown>>;
  const truncated = unlocked && loadedRows.length > maxMarkers;
  const visibleRows = truncated ? loadedRows.slice(0, maxMarkers) : loadedRows;
  const summaries = visibleRows
    .map((row) => companySummaryFromSearchRow(row))
    .filter((item): item is CompanySummary => Boolean(item && item.cnpj));

  const totalResults = Math.max(0, Number(search.total_results ?? 0) || 0);
  const storedCount = Number(queryPayload.mergedResults ?? totalResults) || 0;
  const lockedCount = unlocked ? 0 : Math.max(0, storedCount - summaries.length);

  const ids = summaries.map((item) => item.id).filter(Boolean);
  const { data: savedRows } = ids.length
    ? await db.from("saved_establishments").select("establishment_id").eq("profile_id", profileId).in("establishment_id", ids)
    : { data: [] as Array<{ establishment_id: string }> };
  const savedIds = new Set(((savedRows ?? []) as Array<{ establishment_id: string }>).map((row) => String(row.establishment_id)));

  const ceps = summaries.map((item) => normalizeCep(item.postalCode)).filter((cep): cep is string => Boolean(cep));
  const [postal, companyLocations] = await Promise.all([
    (options.resolvePostal ?? resolvePostalCodes)(ceps),
    loadCompanyLocationCache(summaries.map((item) => item.cnpj))
  ]);

  const companies = buildMapCompanies(summaries, savedIds, postal.points, companyLocations);
  const stats = summarizeMapCompanies(companies);
  const located = companies
    .filter((company) => company.location)
    .map((company) => ({ latitude: company.location!.latitude, longitude: company.location!.longitude }));

  const hitFetchLimit = queryPayload.hitFetchLimit === true;

  return {
    searchId,
    headline: summary.headline,
    cnaeText: summary.cnaeText,
    locationText: summary.locationText,
    filterLabels: summary.filterLabels,
    createdAt: typeof search.created_at === "string" ? search.created_at : search.created_at instanceof Date ? search.created_at.toISOString() : null,
    totalResults,
    unlocked,
    lockedCount,
    companies,
    stats,
    limits: {
      maxMarkers,
      truncated,
      tooManyResults: truncated || hitFetchLimit || totalResults > Math.max(storedCount, companies.length)
    },
    bounds: boundsFromPoints(located),
    regions: buildRegionSeats(summaries),
    geocoding: { enabled: postal.enabled, pendingPostalCodes: postal.pending }
  };
}
