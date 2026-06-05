import { createDbClient } from "@/lib/db-client";
import { hydrateNormalizedEstablishment, normalizeCompanySizeInput, canonicalizeEstablishment, normalizedToPresenterSource, mergeNormalizedEstablishments } from "@/lib/establishment-canonical";
import { getDiscoveryAutoRefinementThreshold, getDiscoveryCacheTtlHours, getDiscoveryProvider, getMinimumCheckoutAmountCents } from "@/lib/env";
import { DiscoverySearchInput, NormalizedEstablishment, ServiceResult } from "@/lib/types";
import { normalizeCode, normalizeCnpj, normalizeText, sha256, toTitleCase } from "@/lib/utils";
import { buildLeadPricingSummary } from "@/lib/lead-pricing";
import { searchWithCasaDosDados } from "./providers/casadosdados";
import { searchWithCnpjWs } from "./providers/cnpjws";
import { searchWithHybrid } from "./providers/hybrid";
import { ensureSearchAccessOrderForSearch } from "@/lib/billing";

type PublicCitySelection = {
  cityName: string;
  stateCode: string;
};

type SearchTarget = {
  cityName: string;
  stateCode: string;
};

type PrepareSearchOrderInput = {
  profileId: string | null;
  email: string;
  cnae: string;
  stateCode: string;
  citySelection: string;
  stateWide: boolean;
  requireEmail: boolean;
  requireAddress: boolean;
  requirePhone: boolean;
  mobileOnly: boolean;
  companySizes: string[];
  simplesOnly: boolean;
  capitalSocialMin: number | null;
  capitalSocialMax: number | null;
  activityStartYear: number | null;
  activityStartYearExact: boolean;
};


function normalizeCompanySizeLabel(value: string) {
  return normalizeCompanySizeInput(value) ?? "";
}

function parseCapitalValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseOpenedAtYear(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const yearPrefix = trimmed.match(/^(\d{4})/);
  if (yearPrefix) {
    const parsed = Number(yearPrefix[1]);
    return Number.isInteger(parsed) ? parsed : null;
  }
  const brazilianDate = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brazilianDate) {
    const parsed = Number(brazilianDate[3]);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function extractActivityStartYearFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.data_inicio_atividade,
    record.data_abertura,
    record.abertura,
    (record.consulta_cnpj as any)?.data_inicio_atividade,
    (record.consulta_cnpj as any)?.data_abertura,
    (record.cnpjws_consulta as any)?.data_inicio_atividade,
    (record.cnpjws_consulta as any)?.data_abertura,
    (record.pesquisa as any)?.data_inicio_atividade,
    (record.pesquisa as any)?.data_abertura
  ];
  for (const value of candidates) {
    const year = parseOpenedAtYear(value);
    if (year !== null) return year;
  }
  return null;
}

function hasAdvancedPublicFilters(input: Pick<PrepareSearchOrderInput, "requireEmail" | "requireAddress" | "requirePhone" | "mobileOnly" | "companySizes" | "simplesOnly" | "capitalSocialMin" | "capitalSocialMax" | "activityStartYear">) {
  return Boolean(
    input.requireEmail ||
    input.requireAddress ||
    input.requirePhone ||
    input.mobileOnly ||
    input.simplesOnly ||
    (input.companySizes?.length ?? 0) > 0 ||
    input.capitalSocialMin !== null ||
    input.capitalSocialMax !== null ||
    input.activityStartYear !== null
  );
}


export function buildAutoRefinementMetadata(totalFound: number, threshold = getDiscoveryAutoRefinementThreshold()) {
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? Math.trunc(threshold) : 1500;
  const shouldSuggest = totalFound > safeThreshold;
  return {
    autoRefinementSuggested: shouldSuggest,
    autoRefinementReason: shouldSuggest
      ? `Busca ampla com ${totalFound} resultados. Recomendamos recorte temporal por ano para melhorar a precisão.`
      : "",
    suggestedActivityStartYear: shouldSuggest ? new Date().getFullYear() - 2 : null,
    suggestedActivityStartYearExact: shouldSuggest ? false : null
  };
}

function normalizeStoredEstablishmentRow(row: Record<string, unknown>): NormalizedEstablishment {
  return hydrateNormalizedEstablishment({
    cnpj: normalizeCnpj(String(row.cnpj ?? "")),
    cnpjRoot: typeof row.cnpj_root === "string" ? row.cnpj_root : null,
    companyName: typeof row.company_name === "string" && row.company_name.trim() ? row.company_name : "Sem razão social",
    tradeName: typeof row.trade_name === "string" ? row.trade_name : null,
    registrationStatus: typeof row.registration_status === "string" ? row.registration_status : null,
    openedAt: typeof row.opened_at === "string" ? row.opened_at : null,
    primaryCnaeCode: typeof row.primary_cnae_code === "string" ? row.primary_cnae_code : null,
    primaryCnaeDescription: typeof row.primary_cnae_description === "string" ? row.primary_cnae_description : null,
    secondaryCnaes: row.secondary_cnaes ?? null,
    legalNatureCode: typeof row.legal_nature_code === "string" ? row.legal_nature_code : null,
    legalNatureDescription: typeof row.legal_nature_description === "string" ? row.legal_nature_description : null,
    companySize: typeof row.company_size === "string" ? row.company_size : null,
    simplesOptIn: typeof row.simples_opt_in === "boolean" ? row.simples_opt_in : null,
    meiOptIn: typeof row.mei_opt_in === "boolean" ? row.mei_opt_in : null,
    capitalSocial:
      typeof row.capital_social === "number"
        ? row.capital_social
        : typeof row.capital_social === "string"
          ? Number.isFinite(Number(row.capital_social.replace(/[^\d,-.]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", ".")))
            ? Number(row.capital_social.replace(/[^\d,-.]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", "."))
            : null
          : null,
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    website: typeof row.website === "string" ? row.website : null,
    country: typeof row.country === "string" ? row.country : null,
    stateCode: typeof row.state_code === "string" ? row.state_code : null,
    cityName: typeof row.city_name === "string" ? row.city_name : null,
    cityIbge: typeof row.city_ibge === "string" ? row.city_ibge : null,
    neighborhood: typeof row.neighborhood === "string" ? row.neighborhood : null,
    cep: typeof row.cep === "string" ? row.cep : null,
    addressLine: typeof row.address_line === "string" ? row.address_line : null,
    addressNumber: typeof row.address_number === "string" ? row.address_number : null,
    complement: typeof row.complement === "string" ? row.complement : null,
    providerPayload: row.provider_payload ?? null
  });
}

async function fetchStoredEstablishmentsForTarget(target: SearchTarget, cnaeCode: string) {
  const db = createDbClient();
  let query = db
    .from("establishments")
    .select("cnpj, cnpj_root, company_name, trade_name, registration_status, opened_at, primary_cnae_code, primary_cnae_description, secondary_cnaes, legal_nature_code, legal_nature_description, company_size, simples_opt_in, mei_opt_in, capital_social, email, phone, website, country, state_code, city_name, city_ibge, neighborhood, cep, address_line, address_number, complement, provider_payload")
    .eq("state_code", target.stateCode)
    .eq("primary_cnae_code", cnaeCode)
    .limit(1000);

  if (target.cityName.trim()) {
    query = query.ilike("city_name", target.cityName);
  }

  const { data, error } = await query;
  if (error || !data) return [] as NormalizedEstablishment[];
  return data
    .map((row: Record<string, unknown>) => normalizeStoredEstablishmentRow(row))
    .filter((row: NormalizedEstablishment) => Boolean(normalizeCnpj(row.cnpj)));
}

function formatServiceError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      details?: unknown;
      detail?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    const parts = [candidate.message, candidate.details, candidate.detail, candidate.hint]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    if (parts.length > 0) {
      return parts.join(" | ");
    }

    if (typeof candidate.code === "string" && candidate.code.trim()) {
      return `${fallback} (código ${candidate.code.trim()})`;
    }
  }

  return fallback;
}

function splitMultilineValues(value: string) {
  return value
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCitySelections(value: string): PublicCitySelection[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    const unique = new Map<string, PublicCitySelection>();
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.cityName !== "string" || typeof candidate.stateCode !== "string") continue;
      const cityName = toTitleCase(normalizeText(candidate.cityName));
      const stateCode = candidate.stateCode.trim().toUpperCase();
      if (!cityName || !stateCode) continue;
      unique.set(`${cityName}|${stateCode}`, { cityName, stateCode });
    }

    return Array.from(unique.values());
  } catch {
    return [];
  }
}

async function fetchCitiesByState(stateCode: string): Promise<PublicCitySelection[]> {
  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateCode.toUpperCase()}/municipios`,
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 * 30 }
    }
  );

  if (!response.ok) {
    throw new Error(`Falha ao carregar cidades do estado ${stateCode}.`);
  }

  const rows = (await response.json()) as Array<{ nome: string }>;
  return rows.map((row) => ({
    cityName: toTitleCase(row.nome),
    stateCode: stateCode.toUpperCase()
  }));
}




async function mergeRowsWithStoredEstablishments(rows: NormalizedEstablishment[]) {
  if (rows.length === 0) return rows;

  const db = createDbClient();
  const normalizedCnpjs = Array.from(new Set(rows.map((row) => normalizeCnpj(row.cnpj)).filter(Boolean)));

  if (normalizedCnpjs.length === 0) return rows;

  const { data: storedRows, error } = await db
    .from("establishments")
    .select("cnpj, cnpj_root, company_name, trade_name, registration_status, opened_at, primary_cnae_code, primary_cnae_description, secondary_cnaes, legal_nature_code, legal_nature_description, company_size, simples_opt_in, mei_opt_in, capital_social, email, phone, website, country, state_code, city_name, city_ibge, neighborhood, cep, address_line, address_number, complement, provider_payload")
    .in("cnpj", normalizedCnpjs);

  if (error || !storedRows || storedRows.length === 0) {
    return rows;
  }

  const storedByCnpj = new Map<string, NormalizedEstablishment>(
    storedRows.map((row: Record<string, unknown>) => [normalizeCnpj(String(row.cnpj ?? "")), normalizeStoredEstablishmentRow(row)])
  );

  return rows.map((row) => {
    const normalizedCnpj = normalizeCnpj(row.cnpj);
    const stored = storedByCnpj.get(normalizedCnpj);
    return stored ? mergeNormalizedEstablishments(hydrateNormalizedEstablishment(row), stored) : row;
  });
}

function dedupeNormalizedRows(rows: NormalizedEstablishment[]) {
  const aggregated = new Map<string, NormalizedEstablishment>();

  for (const row of rows) {
    const normalizedCnpj = normalizeCnpj(row.cnpj);
    if (!normalizedCnpj) continue;
    const hydrated = hydrateNormalizedEstablishment({ ...row, cnpj: normalizedCnpj });
    const existing = aggregated.get(normalizedCnpj);
    aggregated.set(normalizedCnpj, existing ? mergeNormalizedEstablishments(existing, hydrated) : hydrated);
  }

  return Array.from(aggregated.values());
}


function readHybridEnrichmentSummary(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).enriquecimento_cnpjws;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    status: typeof record.status === "string" ? record.status : "desconhecido",
    successCount: typeof record.sucessos === "number" ? Math.max(0, Math.trunc(record.sucessos)) : 0,
    failureCount: typeof record.falhas === "number" ? Math.max(0, Math.trunc(record.falhas)) : 0
  };
}

function resolveTotalFound(providerTotalResults: number | null | undefined, dedupedCount: number) {
  if (typeof providerTotalResults === "number" && Number.isFinite(providerTotalResults)) {
    return Math.max(0, Math.trunc(providerTotalResults));
  }
  return Math.max(0, Math.trunc(dedupedCount));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  if (items.length === 0) return [] as R[];

  const size = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: size }, () => run()));
  return results;
}

function buildPublicFilterLabels(input: PrepareSearchOrderInput) {
  const labels: string[] = [];
  if (input.requireEmail || input.requireAddress || input.requirePhone || input.mobileOnly) {
    labels.push("Com dados adicionais disponíveis");
  }
  if (input.simplesOnly || input.companySizes.length > 0 || input.capitalSocialMin !== null || input.capitalSocialMax !== null || input.activityStartYear !== null) {
    labels.push("Com recorte complementar aplicado");
  }
  return labels;
}

function applyPublicFilters<
  T extends {
    email?: string | null;
    addressLine?: string | null;
    phone?: string | null;
    companySize?: string | null;
    simplesOptIn?: boolean | null;
    capitalSocial?: number | string | null;
    openedAt?: string | null;
    providerPayload?: unknown;
  }
>(
  rows: T[],
  input: PrepareSearchOrderInput,
  options?: { skipEmail?: boolean; skipPhone?: boolean; skipMobileOnly?: boolean }
) {
  const normalizedSizes = input.companySizes
    .map((item) => normalizeCompanySizeLabel(item))
    .filter(Boolean);

  return rows.filter((row) => {
    const canonical = canonicalizeEstablishment(normalizedToPresenterSource(row as unknown as NormalizedEstablishment));

    if (input.requireEmail && !options?.skipEmail && !canonical.hasEmail) return false;
    if (input.requireAddress && !canonical.hasAddress) return false;
    if (input.requirePhone && !options?.skipPhone && !canonical.hasPhone) return false;
    if (input.mobileOnly && !options?.skipMobileOnly && !(canonical.hasPhone && canonical.isMobilePhone)) return false;
    if (input.simplesOnly && canonical.simplesOptIn !== true) return false;
    if (normalizedSizes.length > 0 && (!canonical.companySizeCode || !normalizedSizes.includes(canonical.companySizeCode))) return false;
    if (input.capitalSocialMin !== null && (canonical.capitalSocialValue === null || canonical.capitalSocialValue < input.capitalSocialMin)) return false;
    if (input.capitalSocialMax !== null && (canonical.capitalSocialValue === null || canonical.capitalSocialValue > input.capitalSocialMax)) return false;
    if (input.activityStartYear !== null) {
      const openedAtYear = canonical.openedYear ?? extractActivityStartYearFromPayload(row.providerPayload);
      if (openedAtYear === null || openedAtYear < input.activityStartYear) return false;
      if (input.activityStartYearExact && openedAtYear !== input.activityStartYear) return false;
    }
    return true;
  });
}

export async function prepareSearchOrder(
  input: PrepareSearchOrderInput
): Promise<ServiceResult<{ orderId: string; searchId: string; accessToken: string }>> {
  try {
    const db = createDbClient();
    const provider = getDiscoveryProvider();
    const email = input.email.trim().toLowerCase();

    if (input.profileId && email) {
      const { error: profileError } = await db.from("profiles").upsert(
        {
          id: input.profileId,
          email
        },
        { onConflict: "id" }
      );

      if (profileError) {
        throw profileError;
      }
    }
    const cnaes = Array.from(new Set(splitMultilineValues(input.cnae).map((item) => normalizeCode(item)).filter(Boolean)));
    const stateCodes = Array.from(
      new Set(
        splitMultilineValues(input.stateCode)
          .map((item) => item.trim().toUpperCase())
          .filter((item) => item.length === 2)
      )
    );
    input.companySizes = Array.from(new Set(input.companySizes.map((item) => item.trim()).filter(Boolean)));

    if (cnaes.length === 0) {
      return { ok: false, error: "Selecione ao menos um CNAE." };
    }
    if (stateCodes.length === 0) {
      return { ok: false, error: "Selecione ao menos um estado." };
    }

    let citySelections = parseCitySelections(input.citySelection);
    let searchTargets: SearchTarget[] = [];

    if (input.stateWide) {
      if (provider === "casadosdados" || provider === "hybrid") {
        searchTargets = stateCodes.map((stateCode) => ({ cityName: "", stateCode }));
      } else {
        const groups = await Promise.all(stateCodes.map((stateCode) => fetchCitiesByState(stateCode)));
        citySelections = groups.flat();
      }
    }

    if (searchTargets.length === 0) {
      if (citySelections.length === 0) {
        return {
          ok: false,
          error: input.stateWide
            ? "Não foi possível carregar as cidades do estado selecionado."
            : "Selecione ao menos uma cidade ou marque a busca estadual."
        };
      }

      searchTargets = Array.from(
        new Map(citySelections.map((item) => [`${item.cityName}|${item.stateCode}`, item])).values()
      );
    }

    const aggregatedByCnpj = new Map<string, NormalizedEstablishment>();
    const searchCombos = cnaes.flatMap((cnaeCode) => searchTargets.map((target) => ({ cnaeCode, target })));

    const searchResponses = await mapWithConcurrency(searchCombos, provider === "cnpjws" ? 2 : 4, async ({ cnaeCode, target }) => {
      const providerInput = {
        profileId: input.profileId ?? "public",
        cnae: cnaeCode,
        stateCode: target.stateCode,
        cityName: target.cityName,
        cityIbge: "",
        requireEmail: input.requireEmail,
        requireAddress: input.requireAddress,
        requirePhone: input.requirePhone,
        mobileOnly: input.mobileOnly,
        companySizes: input.companySizes,
        simplesOnly: input.simplesOnly,
        capitalSocialMin: input.capitalSocialMin,
        capitalSocialMax: input.capitalSocialMax,
        activityStartYear: input.activityStartYear,
        activityStartYearExact: input.activityStartYearExact
      };

      const providerResponse =
        provider === "casadosdados"
          ? await searchWithCasaDosDados(providerInput)
          : provider === "hybrid"
            ? await searchWithHybrid(providerInput)
            : await searchWithCnpjWs(providerInput);

      const localRows = hasAdvancedPublicFilters(input)
        ? await fetchStoredEstablishmentsForTarget(target, cnaeCode)
        : [];

      const hydratedRows = await mergeRowsWithStoredEstablishments(
        dedupeNormalizedRows([
          ...providerResponse.normalized.map((row) => hydrateNormalizedEstablishment(row)),
          ...localRows
        ])
      );

      const filteredRows = applyPublicFilters(hydratedRows, input);
      return {
        filteredRows,
        providerTotalResults: providerResponse.providerTotalResults ?? null,
        fetchedResults: providerResponse.fetchedResults ?? providerResponse.normalized.length,
        hitFetchLimit: providerResponse.hitFetchLimit ?? false,
        cnpjWsEnrichment: provider === "hybrid" ? readHybridEnrichmentSummary(providerResponse.raw) : null
      };
    });

    let providerTotalResults: number | null = null;
    let fetchedResults = 0;
    let hitFetchLimit = false;
    let cnpjWsEnrichmentSuccesses = 0;
    let cnpjWsEnrichmentFailures = 0;

    for (const response of searchResponses) {
      if (providerTotalResults === null && typeof response.providerTotalResults === "number") {
        providerTotalResults = response.providerTotalResults;
      }
      fetchedResults += Math.max(0, Math.trunc(response.fetchedResults ?? 0));
      hitFetchLimit = hitFetchLimit || response.hitFetchLimit;
      if (response.cnpjWsEnrichment) {
        cnpjWsEnrichmentSuccesses += response.cnpjWsEnrichment.successCount;
        cnpjWsEnrichmentFailures += response.cnpjWsEnrichment.failureCount;
      }

      for (const row of response.filteredRows) {
        const normalizedCnpj = normalizeCnpj(row.cnpj);
        if (!normalizedCnpj) continue;
        const hydratedRow = hydrateNormalizedEstablishment({ ...row, cnpj: normalizedCnpj });
        const existing = aggregatedByCnpj.get(normalizedCnpj);
        aggregatedByCnpj.set(normalizedCnpj, existing ? mergeNormalizedEstablishments(existing, hydratedRow) : hydratedRow);
      }
    }

    const allRows = dedupeNormalizedRows(Array.from(aggregatedByCnpj.values()));
    const mergedResults = allRows.length;
    const totalFound = resolveTotalFound(providerTotalResults, mergedResults);
    const pricingSummary = buildLeadPricingSummary(
      allRows.map((row) => ({
        email: row.email,
        phone: row.phone,
        providerPayload: row.providerPayload
      }))
    );
    const pricingTotalAmountCents = pricingSummary.totalLeads > 0
      ? Math.max(pricingSummary.totalAmountCents, getMinimumCheckoutAmountCents(), 0)
      : 0;
    const queryPayload = {
      cnaes,
      stateCodes,
      citySelections: searchTargets.filter((item) => item.cityName),
      stateWideTargets: input.stateWide ? searchTargets.map((item) => item.stateCode) : [],
      stateWide: input.stateWide,
      requireEmail: input.requireEmail,
      requireAddress: input.requireAddress,
      requirePhone: input.requirePhone,
      mobileOnly: input.mobileOnly,
      companySizes: input.companySizes,
      simplesOnly: input.simplesOnly,
      capitalSocialMin: input.capitalSocialMin,
      capitalSocialMax: input.capitalSocialMax,
      activityStartYear: input.activityStartYear,
      activityStartYearExact: input.activityStartYearExact,
      filterLabels: buildPublicFilterLabels(input),
      providerTotalResults: providerTotalResults ?? null,
      fetchedResults,
      mergedResults,
      hitFetchLimit,
      cnpjWsEnrichmentStatus: provider === "hybrid"
        ? cnpjWsEnrichmentSuccesses + cnpjWsEnrichmentFailures === 0
          ? null
          : cnpjWsEnrichmentFailures === 0
            ? "sucesso"
            : cnpjWsEnrichmentSuccesses > 0
              ? "parcial"
              : "falhou"
        : null,
      cnpjWsEnrichmentFailures: provider === "hybrid" ? cnpjWsEnrichmentFailures : null,
      leadPricingSummary: {
        basic: pricingSummary.tiers.find((tier) => tier.key === "basic")?.count ?? 0,
        phone: pricingSummary.tiers.find((tier) => tier.key === "phone")?.count ?? 0,
        email: pricingSummary.tiers.find((tier) => tier.key === "email")?.count ?? 0,
        complete: pricingSummary.tiers.find((tier) => tier.key === "complete")?.count ?? 0,
        totalLeads: pricingSummary.totalLeads,
        totalAmountCents: pricingTotalAmountCents
      }
    };
    Object.assign(queryPayload, buildAutoRefinementMetadata(totalFound));

    const representativeLocation =
      searchTargets.find((item) => item.cityName.trim().length > 0) ??
      citySelections[0] ??
      {
        cityName: input.stateWide ? "Busca estadual" : "Brasil",
        stateCode: stateCodes[0] ?? "BR"
      };
    const cacheKey = sha256(JSON.stringify({ provider, queryPayload }));

    const { data: insertedSearch, error: searchError } = await db
      .from("search_queries")
      .insert({
        profile_id: input.profileId,
        provider,
        cache_key: cacheKey,
        cnae_code: cnaes[0],
        city_name: representativeLocation.cityName,
        state_code: representativeLocation.stateCode,
        city_ibge: null,
        query_payload: queryPayload,
        total_results: totalFound,
        cached: false
      })
      .select("id")
      .single();

    if (searchError || !insertedSearch) {
      throw searchError ?? new Error("Não foi possível registrar a busca pública.");
    }

    if (allRows.length > 0) {
      const establishmentsPayload = allRows.map((row) => ({
        cnpj: row.cnpj,
        cnpj_root: row.cnpjRoot,
        company_name: row.companyName,
        trade_name: row.tradeName,
        registration_status: row.registrationStatus,
        opened_at: row.openedAt,
        primary_cnae_code: row.primaryCnaeCode,
        primary_cnae_description: row.primaryCnaeDescription,
        secondary_cnaes: row.secondaryCnaes,
        legal_nature_code: row.legalNatureCode,
        legal_nature_description: row.legalNatureDescription,
        company_size: row.companySize,
        simples_opt_in: row.simplesOptIn,
        mei_opt_in: row.meiOptIn,
        capital_social: row.capitalSocial,
        email: row.email,
        phone: row.phone,
        website: row.website,
        country: row.country,
        state_code: row.stateCode,
        city_name: row.cityName,
        city_ibge: row.cityIbge,
        neighborhood: row.neighborhood,
        cep: row.cep,
        address_line: row.addressLine,
        address_number: row.addressNumber,
        complement: row.complement,
        provider_payload: row.providerPayload
      }));

      const { error: establishmentsError } = await db.from("establishments").upsert(establishmentsPayload, { onConflict: "cnpj" });

      if (establishmentsError) {
        throw establishmentsError;
      }

      const { data: storedEstablishments, error: storedEstablishmentsError } = await db
        .from("establishments")
        .select("id, cnpj")
        .in(
          "cnpj",
          allRows.map((row) => row.cnpj)
        );

      if (storedEstablishmentsError) {
        throw storedEstablishmentsError;
      }

      const establishmentMap = new Map((storedEstablishments ?? []).map((item) => [item.cnpj, item.id]));
      const searchResultsPayload = allRows
        .map((row, index) => {
          const establishmentId = establishmentMap.get(row.cnpj);
          if (!establishmentId) return null;
          return {
            search_query_id: insertedSearch.id,
            profile_id: input.profileId,
            establishment_id: establishmentId,
            position: index + 1,
            provider_payload: row.providerPayload
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      if (searchResultsPayload.length > 0) {
        const { error: searchResultsError } = await db.from("search_results").insert(searchResultsPayload);

        if (searchResultsError) {
          throw searchResultsError;
        }
      }
    }

    const order = await ensureSearchAccessOrderForSearch({
      searchQueryId: insertedSearch.id,
      profileId: input.profileId,
      email,
      provider,
      totalResults: mergedResults,
      pricingSummary
    });

    return { ok: true, data: { orderId: order.id, searchId: insertedSearch.id, accessToken: order.access_token } };
  } catch (error) {
    return {
      ok: false,
      error: formatServiceError(error, "Falha ao preparar o pedido da pesquisa.")
    };
  }
}

function normalizeInput(input: DiscoverySearchInput) {
  return {
    profileId: input.profileId,
    cnae: normalizeCode(input.cnae),
    stateCode: input.stateCode.trim().toUpperCase(),
    cityName: toTitleCase(normalizeText(input.cityName)),
    cityIbge: normalizeCode(input.cityIbge ?? ""),
    requireEmail: input.requireEmail ?? false,
    requireAddress: input.requireAddress ?? false,
    requirePhone: input.requirePhone ?? false,
    mobileOnly: input.mobileOnly ?? false,
    companySizes: input.companySizes ?? [],
    simplesOnly: input.simplesOnly ?? false,
    capitalSocialMin: input.capitalSocialMin ?? null,
    capitalSocialMax: input.capitalSocialMax ?? null,
    activityStartYear: input.activityStartYear ?? null,
    activityStartYearExact: input.activityStartYearExact ?? false
  };
}

function buildCacheKey(input: ReturnType<typeof normalizeInput>, provider: string) {
  return sha256(
    JSON.stringify({
      provider,
      cnae: input.cnae,
      stateCode: input.stateCode,
      cityName: input.cityName,
      cityIbge: input.cityIbge,
      requireEmail: input.requireEmail,
      requireAddress: input.requireAddress,
      requirePhone: input.requirePhone,
      mobileOnly: input.mobileOnly,
      companySizes: input.companySizes,
      simplesOnly: input.simplesOnly,
      capitalSocialMin: input.capitalSocialMin,
      capitalSocialMax: input.capitalSocialMax,
      activityStartYear: input.activityStartYear,
      activityStartYearExact: input.activityStartYearExact
    })
  );
}

export async function runDiscoverySearch(
  input: DiscoverySearchInput
): Promise<ServiceResult<{ searchId: string }>> {
  try {
    const provider = getDiscoveryProvider();
    const normalizedInput = normalizeInput(input);

    if (!normalizedInput.cnae || !normalizedInput.cityName || !normalizedInput.stateCode) {
      return {
        ok: false,
        error: "Preencha CNAE, cidade e UF."
      };
    }

    const db = createDbClient();
    const cacheKey = buildCacheKey(normalizedInput, provider);

    const now = new Date();
    const { data: cached } = await db
      .from("provider_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .gt("expires_at", now.toISOString())
      .maybeSingle();

    let raw: unknown;
    let normalizedRows: NormalizedEstablishment[] = [];
    let cachedHit = false;
    let providerTotalResults: number | null = null;
    let fetchedResults: number | null = null;
    let hitFetchLimit = false;
    let cnpjWsEnrichment = null as ReturnType<typeof readHybridEnrichmentSummary>;
    const localRows = hasAdvancedPublicFilters({
      requireEmail: normalizedInput.requireEmail,
      requireAddress: normalizedInput.requireAddress,
      requirePhone: normalizedInput.requirePhone,
      mobileOnly: normalizedInput.mobileOnly,
      companySizes: normalizedInput.companySizes,
      simplesOnly: normalizedInput.simplesOnly,
      capitalSocialMin: normalizedInput.capitalSocialMin,
      capitalSocialMax: normalizedInput.capitalSocialMax,
      activityStartYear: normalizedInput.activityStartYear
    })
      ? await fetchStoredEstablishmentsForTarget({ cityName: normalizedInput.cityName, stateCode: normalizedInput.stateCode }, normalizedInput.cnae)
      : [];

    if (cached?.response_payload) {
      raw = cached.response_payload;
      normalizedRows = Array.isArray(cached.normalized_payload)
        ? await mergeRowsWithStoredEstablishments(
            dedupeNormalizedRows([
              ...(cached.normalized_payload as typeof normalizedRows).map((row) => hydrateNormalizedEstablishment(row)),
              ...localRows
            ])
          )
        : localRows;
      cachedHit = true;
    } else {
      const providerResponse =
        provider === "casadosdados"
          ? await searchWithCasaDosDados(normalizedInput)
          : provider === "hybrid"
            ? await searchWithHybrid(normalizedInput)
            : await searchWithCnpjWs(normalizedInput);

      raw = providerResponse.raw;
      providerTotalResults = providerResponse.providerTotalResults ?? null;
      fetchedResults = providerResponse.fetchedResults ?? providerResponse.normalized.length;
      hitFetchLimit = providerResponse.hitFetchLimit ?? false;
      cnpjWsEnrichment = provider === "hybrid" ? readHybridEnrichmentSummary(providerResponse.raw) : null;
      normalizedRows = await mergeRowsWithStoredEstablishments(
        dedupeNormalizedRows([
          ...providerResponse.normalized.map((row) => hydrateNormalizedEstablishment(row)),
          ...localRows
        ])
      );

      const expiresAt = new Date(now.getTime() + getDiscoveryCacheTtlHours() * 60 * 60 * 1000);

      await db.from("provider_cache").upsert(
        {
          cache_key: cacheKey,
          provider,
          request_payload: normalizedInput,
          response_payload: raw,
          normalized_payload: normalizedRows,
          fetched_at: now.toISOString(),
          expires_at: expiresAt.toISOString()
        },
        {
          onConflict: "cache_key"
        }
      );
    }

    const filteredRows = applyPublicFilters(normalizedRows, {
      profileId: normalizedInput.profileId ?? null,
      email: "dashboard@local",
      cnae: normalizedInput.cnae,
      stateCode: normalizedInput.stateCode,
      citySelection: JSON.stringify([{ cityName: normalizedInput.cityName, stateCode: normalizedInput.stateCode }]),
      stateWide: false,
      requireEmail: input.requireEmail ?? false,
      requireAddress: input.requireAddress ?? false,
      requirePhone: input.requirePhone ?? false,
      mobileOnly: input.mobileOnly ?? false,
      companySizes: normalizedInput.companySizes,
      simplesOnly: normalizedInput.simplesOnly,
      capitalSocialMin: normalizedInput.capitalSocialMin,
      capitalSocialMax: normalizedInput.capitalSocialMax,
      activityStartYear: normalizedInput.activityStartYear,
      activityStartYearExact: normalizedInput.activityStartYearExact
    });

    const cleanRows = dedupeNormalizedRows(filteredRows)
      .map((row) => ({
        ...row,
        cnpj: normalizeCnpj(row.cnpj)
      }))
      .filter((row) => row.cnpj);
    const mergedResults = cleanRows.length;
    const totalFound = resolveTotalFound(providerTotalResults, mergedResults);
    const queryPayload = {
      ...normalizedInput,
      providerTotalResults,
      fetchedResults: fetchedResults ?? mergedResults,
      mergedResults,
      hitFetchLimit,
      cnpjWsEnrichmentStatus: provider === "hybrid" ? cnpjWsEnrichment?.status ?? null : null,
      cnpjWsEnrichmentFailures: provider === "hybrid" ? cnpjWsEnrichment?.failureCount ?? null : null
    };
    Object.assign(queryPayload, buildAutoRefinementMetadata(totalFound));

    const establishmentsPayload = cleanRows.map((row) => ({
      cnpj: row.cnpj,
      cnpj_root: row.cnpjRoot,
      company_name: row.companyName,
      trade_name: row.tradeName,
      registration_status: row.registrationStatus,
      opened_at: row.openedAt,
      primary_cnae_code: row.primaryCnaeCode,
      primary_cnae_description: row.primaryCnaeDescription,
      secondary_cnaes: row.secondaryCnaes,
      legal_nature_code: row.legalNatureCode,
      legal_nature_description: row.legalNatureDescription,
      company_size: row.companySize,
      simples_opt_in: row.simplesOptIn,
      mei_opt_in: row.meiOptIn,
      capital_social: row.capitalSocial,
      email: row.email,
      phone: row.phone,
      website: row.website,
      country: row.country,
      state_code: row.stateCode,
      city_name: row.cityName,
      city_ibge: row.cityIbge,
      neighborhood: row.neighborhood,
      cep: row.cep,
      address_line: row.addressLine,
      address_number: row.addressNumber,
      complement: row.complement,
      provider_payload: row.providerPayload
    }));

    if (establishmentsPayload.length > 0) {
      await db.from("establishments").upsert(establishmentsPayload, {
        onConflict: "cnpj"
      });
    }

    const { data: storedEstablishments } = cleanRows.length
      ? await db
          .from("establishments")
          .select("id, cnpj")
          .in(
            "cnpj",
            cleanRows.map((row) => row.cnpj)
          )
      : { data: [] as Array<{ id: string; cnpj: string }> };

    const establishmentMap = new Map((storedEstablishments ?? []).map((item) => [item.cnpj, item.id]));

    const { data: insertedSearch, error: searchError } = await db
      .from("search_queries")
      .insert({
        profile_id: normalizedInput.profileId,
        provider,
        cache_key: cacheKey,
        cnae_code: normalizedInput.cnae,
        city_name: normalizedInput.cityName,
        state_code: normalizedInput.stateCode,
        city_ibge: normalizedInput.cityIbge || null,
        query_payload: queryPayload,
        total_results: totalFound,
        cached: cachedHit
      })
      .select("id")
      .single();

    if (searchError || !insertedSearch) {
      throw searchError ?? new Error("Não foi possível salvar a busca.");
    }

    if (cleanRows.length > 0) {
      const searchResultsPayload = cleanRows
        .map((row, index) => {
          const establishmentId = establishmentMap.get(row.cnpj);
          if (!establishmentId) return null;

          return {
            search_query_id: insertedSearch.id,
            profile_id: normalizedInput.profileId,
            establishment_id: establishmentId,
            position: index + 1,
            provider_payload: row.providerPayload
          };
        })
        .filter(
          (
            item
          ): item is {
            search_query_id: string;
            profile_id: string;
            establishment_id: string;
            position: number;
            provider_payload: unknown;
          } => item !== null
        );

      if (searchResultsPayload.length > 0) {
        const { error: searchResultsError } = await db.from("search_results").insert(searchResultsPayload);

        if (searchResultsError) {
          throw searchResultsError;
        }
      }
    }

    return {
      ok: true,
      data: {
        searchId: insertedSearch.id
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Falha ao consultar provedor."
    };
  }
}
