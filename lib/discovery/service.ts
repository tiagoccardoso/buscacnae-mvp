import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hydrateNormalizedEstablishment, normalizeCompanySizeInput, canonicalizeEstablishment, normalizedToPresenterSource, mergeNormalizedEstablishments } from "@/lib/establishment-canonical";
import { getDiscoveryCacheTtlHours, getDiscoveryProvider, getMinimumCheckoutAmountCents } from "@/lib/env";
import { DiscoverySearchInput, NormalizedEstablishment, ServiceResult } from "@/lib/types";
import { normalizeCode, normalizeCnpj, normalizeText, parseNumber, sha256, toTitleCase } from "@/lib/utils";
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

type StoredEstablishmentRow = {
  cnpj: string;
  cnpj_root: string | null;
  company_name: string;
  trade_name: string | null;
  registration_status: string | null;
  opened_at: string | null;
  primary_cnae_code: string | null;
  primary_cnae_description: string | null;
  secondary_cnaes: unknown;
  legal_nature_code: string | null;
  legal_nature_description: string | null;
  company_size: string | null;
  simples_opt_in: boolean | null;
  mei_opt_in: boolean | null;
  capital_social: number | string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  country: string | null;
  state_code: string | null;
  city_name: string | null;
  city_ibge: string | null;
  neighborhood: string | null;
  cep: string | null;
  address_line: string | null;
  address_number: string | null;
  complement: string | null;
  provider_payload: unknown;
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
};


function normalizeCompanySizeLabel(value: string) {
  return normalizeCompanySizeInput(value) ?? "";
}

function parseCapitalValue(value: unknown) {
  return parseNumber(value);
}

function normalizeCapitalRange(min: number | null, max: number | null) {
  if (min !== null && max !== null && min > max) {
    return { min: max, max: min };
  }
  return { min, max };
}

function normalizeTargetCityName(value: string) {
  return toTitleCase(normalizeText(value));
}

function buildTargetKey(cityName: string, stateCode: string) {
  return `${normalizeTargetCityName(cityName)}|${stateCode.trim().toUpperCase()}`;
}

function mapStoredEstablishmentRow(row: StoredEstablishmentRow): NormalizedEstablishment {
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
    capitalSocial: parseCapitalValue(row.capital_social),
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

async function fetchStoredRowsForTargets(args: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  cnaes: string[];
  searchTargets: SearchTarget[];
  stateWide: boolean;
}) {
  const stateCodes = Array.from(new Set(args.searchTargets.map((item) => item.stateCode.trim().toUpperCase()).filter(Boolean)));
  const normalizedCnaes = Array.from(new Set(args.cnaes.map((item) => normalizeCode(item)).filter(Boolean)));

  if (stateCodes.length === 0 || normalizedCnaes.length === 0) {
    return [] as NormalizedEstablishment[];
  }

  const { data, error } = await args.admin
    .from("establishments")
    .select("cnpj, cnpj_root, company_name, trade_name, registration_status, opened_at, primary_cnae_code, primary_cnae_description, secondary_cnaes, legal_nature_code, legal_nature_description, company_size, simples_opt_in, mei_opt_in, capital_social, email, phone, website, country, state_code, city_name, city_ibge, neighborhood, cep, address_line, address_number, complement, provider_payload")
    .in("primary_cnae_code", normalizedCnaes)
    .in("state_code", stateCodes);

  if (error || !data || data.length === 0) {
    return [] as NormalizedEstablishment[];
  }

  const cityTargetKeys = new Set(
    args.searchTargets
      .filter((item) => item.cityName.trim().length > 0)
      .map((item) => buildTargetKey(item.cityName, item.stateCode))
  );
  const stateWideStates = new Set(
    args.stateWide
      ? args.searchTargets.map((item) => item.stateCode.trim().toUpperCase()).filter(Boolean)
      : []
  );

  return (data as StoredEstablishmentRow[])
    .map((row) => mapStoredEstablishmentRow(row))
    .filter((row) => {
      const normalizedState = row.stateCode?.trim().toUpperCase() ?? "";
      if (!normalizedState) return false;
      if (stateWideStates.has(normalizedState)) return true;
      const cityName = row.cityName ?? "";
      if (!cityName.trim()) return false;
      return cityTargetKeys.has(buildTargetKey(cityName, normalizedState));
    });
}

function parseOpenedAtYear(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : null;
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

  const admin = createSupabaseAdminClient();
  const normalizedCnpjs = Array.from(new Set(rows.map((row) => normalizeCnpj(row.cnpj)).filter(Boolean)));

  if (normalizedCnpjs.length === 0) return rows;

  const { data: storedRows, error } = await admin
    .from("establishments")
    .select("cnpj, cnpj_root, company_name, trade_name, registration_status, opened_at, primary_cnae_code, primary_cnae_description, secondary_cnaes, legal_nature_code, legal_nature_description, company_size, simples_opt_in, mei_opt_in, capital_social, email, phone, website, country, state_code, city_name, city_ibge, neighborhood, cep, address_line, address_number, complement, provider_payload")
    .in("cnpj", normalizedCnpjs);

  if (error || !storedRows || storedRows.length === 0) {
    return rows;
  }

  const storedByCnpj = new Map(
    (storedRows as StoredEstablishmentRow[]).map((row) => [normalizeCnpj(String(row.cnpj ?? "")), mapStoredEstablishmentRow(row)])
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
  if (input.requireEmail) labels.push("E-mail cadastrado");
  if (input.requireAddress) labels.push("Endereço cadastrado");
  if (input.requirePhone) labels.push(input.mobileOnly ? "Apenas Celular" : "Telefone (Fixo ou Celular)");
  if (input.simplesOnly) labels.push("Simples Nacional");
  if (input.companySizes.length > 0) labels.push(`Porte: ${input.companySizes.join(", ")}`);
  if (input.capitalSocialMin !== null) labels.push(`Capital mínimo: R$ ${input.capitalSocialMin.toLocaleString("pt-BR")}`);
  if (input.capitalSocialMax !== null) labels.push(`Capital máximo: R$ ${input.capitalSocialMax.toLocaleString("pt-BR")}`);
  if (input.activityStartYear !== null) labels.push(`Ano mínimo de início da atividade: ${input.activityStartYear}`);
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
    }
    return true;
  });
}

export async function prepareSearchOrder(
  input: PrepareSearchOrderInput
): Promise<ServiceResult<{ orderId: string; searchId: string; accessToken: string }>> {
  try {
    const admin = createSupabaseAdminClient();
    const provider = getDiscoveryProvider();
    const email = input.email.trim().toLowerCase();

    if (input.profileId && email) {
      const { error: profileError } = await admin.from("profiles").upsert(
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
    const normalizedCapitalRange = normalizeCapitalRange(input.capitalSocialMin, input.capitalSocialMax);
    input.capitalSocialMin = normalizedCapitalRange.min;
    input.capitalSocialMax = normalizedCapitalRange.max;

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
      const providerResponse =
        provider === "casadosdados"
          ? await searchWithCasaDosDados({
              profileId: input.profileId ?? "public",
              cnae: cnaeCode,
              stateCode: target.stateCode,
              cityName: target.cityName,
              cityIbge: "",
              requireEmail: false,
              requireAddress: input.requireAddress,
              requirePhone: false,
              mobileOnly: false,
              companySizes: input.companySizes,
              simplesOnly: input.simplesOnly,
              capitalSocialMin: input.capitalSocialMin,
              capitalSocialMax: input.capitalSocialMax,
              activityStartYear: input.activityStartYear
            })
          : provider === "hybrid"
            ? await searchWithHybrid({
                profileId: input.profileId ?? "public",
                cnae: cnaeCode,
                stateCode: target.stateCode,
                cityName: target.cityName,
                cityIbge: "",
                requireEmail: false,
                requireAddress: input.requireAddress,
                requirePhone: false,
                mobileOnly: false,
                companySizes: input.companySizes,
                simplesOnly: input.simplesOnly,
                capitalSocialMin: input.capitalSocialMin,
                capitalSocialMax: input.capitalSocialMax,
                activityStartYear: input.activityStartYear
              })
            : await searchWithCnpjWs({
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
                activityStartYear: input.activityStartYear
              });

      const hydratedRows = await mergeRowsWithStoredEstablishments(
        dedupeNormalizedRows(providerResponse.normalized.map((row) => hydrateNormalizedEstablishment(row)))
      );

      return applyPublicFilters(hydratedRows, input);
    });

    for (const filteredRows of searchResponses) {
      for (const row of filteredRows) {
        const normalizedCnpj = normalizeCnpj(row.cnpj);
        if (!normalizedCnpj) continue;
        const hydratedRow = hydrateNormalizedEstablishment({ ...row, cnpj: normalizedCnpj });
        const existing = aggregatedByCnpj.get(normalizedCnpj);
        aggregatedByCnpj.set(normalizedCnpj, existing ? mergeNormalizedEstablishments(existing, hydratedRow) : hydratedRow);
      }
    }

    const shouldAugmentWithStoredData =
      input.requireEmail ||
      input.requireAddress ||
      input.requirePhone ||
      input.mobileOnly ||
      input.simplesOnly ||
      input.companySizes.length > 0 ||
      input.capitalSocialMin !== null ||
      input.capitalSocialMax !== null ||
      input.activityStartYear !== null;

    if (shouldAugmentWithStoredData) {
      const storedMatches = await fetchStoredRowsForTargets({
        admin,
        cnaes,
        searchTargets,
        stateWide: input.stateWide
      });

      for (const row of applyPublicFilters(storedMatches, input)) {
        const normalizedCnpj = normalizeCnpj(row.cnpj);
        if (!normalizedCnpj) continue;
        const hydratedRow = hydrateNormalizedEstablishment({ ...row, cnpj: normalizedCnpj });
        const existing = aggregatedByCnpj.get(normalizedCnpj);
        aggregatedByCnpj.set(normalizedCnpj, existing ? mergeNormalizedEstablishments(existing, hydratedRow) : hydratedRow);
      }
    }

    const allRows = dedupeNormalizedRows(Array.from(aggregatedByCnpj.values()));
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
      filterLabels: buildPublicFilterLabels(input),
      leadPricingSummary: {
        basic: pricingSummary.tiers.find((tier) => tier.key === "basic")?.count ?? 0,
        phone: pricingSummary.tiers.find((tier) => tier.key === "phone")?.count ?? 0,
        email: pricingSummary.tiers.find((tier) => tier.key === "email")?.count ?? 0,
        complete: pricingSummary.tiers.find((tier) => tier.key === "complete")?.count ?? 0,
        totalLeads: pricingSummary.totalLeads,
        totalAmountCents: pricingTotalAmountCents
      }
    };

    const representativeLocation =
      searchTargets.find((item) => item.cityName.trim().length > 0) ??
      citySelections[0] ??
      {
        cityName: input.stateWide ? "Busca estadual" : "Brasil",
        stateCode: stateCodes[0] ?? "BR"
      };
    const cacheKey = sha256(JSON.stringify({ provider, queryPayload }));

    const { data: insertedSearch, error: searchError } = await admin
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
        total_results: allRows.length,
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

      const { error: establishmentsError } = await admin.from("establishments").upsert(establishmentsPayload, { onConflict: "cnpj" });

      if (establishmentsError) {
        throw establishmentsError;
      }

      const { data: storedEstablishments, error: storedEstablishmentsError } = await admin
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
        const { error: searchResultsError } = await admin.from("search_results").insert(searchResultsPayload);

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
      totalResults: allRows.length,
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
  const normalizedCapitalRange = normalizeCapitalRange(input.capitalSocialMin ?? null, input.capitalSocialMax ?? null);

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
    capitalSocialMin: normalizedCapitalRange.min,
    capitalSocialMax: normalizedCapitalRange.max,
    activityStartYear: input.activityStartYear ?? null
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
      activityStartYear: input.activityStartYear
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

    const admin = createSupabaseAdminClient();
    const cacheKey = buildCacheKey(normalizedInput, provider);

    const now = new Date();
    const { data: cached } = await admin
      .from("provider_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .gt("expires_at", now.toISOString())
      .maybeSingle();

    let raw: unknown;
    let normalizedRows: NormalizedEstablishment[] = [];
    let cachedHit = false;

    if (cached?.response_payload) {
      raw = cached.response_payload;
      normalizedRows = Array.isArray(cached.normalized_payload)
        ? await mergeRowsWithStoredEstablishments(
            dedupeNormalizedRows((cached.normalized_payload as typeof normalizedRows).map((row) => hydrateNormalizedEstablishment(row)))
          )
        : [];
      cachedHit = true;
    } else {
      const providerInput =
        provider === "casadosdados" || provider === "hybrid"
          ? {
              ...normalizedInput,
              requireEmail: false,
              requirePhone: false,
              mobileOnly: false
            }
          : normalizedInput;

      const providerResponse =
        provider === "casadosdados"
          ? await searchWithCasaDosDados(providerInput)
          : provider === "hybrid"
            ? await searchWithHybrid(providerInput)
            : await searchWithCnpjWs(providerInput);

      raw = providerResponse.raw;
      normalizedRows = await mergeRowsWithStoredEstablishments(
        dedupeNormalizedRows(providerResponse.normalized.map((row) => hydrateNormalizedEstablishment(row)))
      );

      const expiresAt = new Date(now.getTime() + getDiscoveryCacheTtlHours() * 60 * 60 * 1000);

      await admin.from("provider_cache").upsert(
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

    const shouldAugmentWithStoredData =
      normalizedInput.requireEmail ||
      normalizedInput.requireAddress ||
      normalizedInput.requirePhone ||
      normalizedInput.mobileOnly ||
      normalizedInput.simplesOnly ||
      normalizedInput.companySizes.length > 0 ||
      normalizedInput.capitalSocialMin !== null ||
      normalizedInput.capitalSocialMax !== null ||
      normalizedInput.activityStartYear !== null;

    if (shouldAugmentWithStoredData) {
      const storedMatches = await fetchStoredRowsForTargets({
        admin,
        cnaes: [normalizedInput.cnae],
        searchTargets: [{ cityName: normalizedInput.cityName, stateCode: normalizedInput.stateCode }],
        stateWide: false
      });

      normalizedRows = dedupeNormalizedRows([...normalizedRows, ...storedMatches]);
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
      activityStartYear: normalizedInput.activityStartYear
    });

    const cleanRows = dedupeNormalizedRows(filteredRows)
      .map((row) => ({
        ...row,
        cnpj: normalizeCnpj(row.cnpj)
      }))
      .filter((row) => row.cnpj);

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
      await admin.from("establishments").upsert(establishmentsPayload, {
        onConflict: "cnpj"
      });
    }

    const { data: storedEstablishments } = cleanRows.length
      ? await admin
          .from("establishments")
          .select("id, cnpj")
          .in(
            "cnpj",
            cleanRows.map((row) => row.cnpj)
          )
      : { data: [] as Array<{ id: string; cnpj: string }> };

    const establishmentMap = new Map((storedEstablishments ?? []).map((item) => [item.cnpj, item.id]));

    const { data: insertedSearch, error: searchError } = await admin
      .from("search_queries")
      .insert({
        profile_id: normalizedInput.profileId,
        provider,
        cache_key: cacheKey,
        cnae_code: normalizedInput.cnae,
        city_name: normalizedInput.cityName,
        state_code: normalizedInput.stateCode,
        city_ibge: normalizedInput.cityIbge || null,
        query_payload: normalizedInput,
        total_results: cleanRows.length,
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
        .filter(Boolean);

      if (searchResultsPayload.length > 0) {
        const { error: searchResultsError } = await admin.from("search_results").insert(searchResultsPayload);

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
