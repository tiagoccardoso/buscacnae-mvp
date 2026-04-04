import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDiscoveryCacheTtlHours, getDiscoveryProvider } from "@/lib/env";
import { DiscoverySearchInput, NormalizedEstablishment, ServiceResult } from "@/lib/types";
import { normalizeCode, normalizeCnpj, normalizeText, sha256, toTitleCase } from "@/lib/utils";
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
};


function normalizeCompanySizeLabel(value: string) {
  return normalizeText(value)
    .replace(/empresa/g, "")
    .replace(/porte/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  }
>(
  rows: T[],
  input: PrepareSearchOrderInput,
  options?: { skipEmail?: boolean; skipPhone?: boolean; skipMobileOnly?: boolean }
) {
  const normalizedSizes = input.companySizes.map((item) => normalizeCompanySizeLabel(item));

  return rows.filter((row) => {
    const hasEmail = !!row.email?.trim();
    const hasAddress = !!row.addressLine?.trim();
    const hasPhone = !!row.phone?.trim();
    const phone = row.phone?.trim() ?? "";
    const digits = phone.replace(/\D/g, "");
    const mobileLike = digits.length >= 10 && ["9", "8", "7"].includes(digits.slice(-9, -8) || digits.charAt(2));
    const companySize = normalizeCompanySizeLabel(row.companySize ?? "");
    const capital = parseCapitalValue(row.capitalSocial);

    if (input.requireEmail && !options?.skipEmail && !hasEmail) return false;
    if (input.requireAddress && !hasAddress) return false;
    if (input.requirePhone && !options?.skipPhone && !hasPhone) return false;
    if (input.mobileOnly && !options?.skipMobileOnly && !(hasPhone && mobileLike)) return false;
    if (input.simplesOnly && row.simplesOptIn !== true) return false;
    if (normalizedSizes.length > 0 && (!companySize || !normalizedSizes.some((item) => companySize.includes(item)))) return false;
    if (input.capitalSocialMin !== null && (capital === null || capital < input.capitalSocialMin)) return false;
    if (input.capitalSocialMax !== null && (capital === null || capital > input.capitalSocialMax)) return false;
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

    if (input.profileId) {
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

    if (!email) {
      return { ok: false, error: "Informe um email válido para receber o acesso da pesquisa." };
    }
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
              requireEmail: input.requireEmail,
              requireAddress: input.requireAddress,
              requirePhone: input.requirePhone,
              mobileOnly: input.mobileOnly
            })
          : provider === "hybrid"
            ? await searchWithHybrid({
                profileId: input.profileId ?? "public",
                cnae: cnaeCode,
                stateCode: target.stateCode,
                cityName: target.cityName,
                cityIbge: "",
                requireEmail: input.requireEmail,
                requireAddress: input.requireAddress,
                requirePhone: input.requirePhone,
                mobileOnly: input.mobileOnly
              })
            : await searchWithCnpjWs({
                profileId: input.profileId ?? "public",
                cnae: cnaeCode,
                stateCode: target.stateCode,
                cityName: target.cityName,
                cityIbge: ""
              });

      return provider === "casadosdados"
        ? applyPublicFilters(providerResponse.normalized, input, {
            skipEmail: input.requireEmail,
            skipPhone: input.requirePhone,
            skipMobileOnly: input.mobileOnly
          })
        : applyPublicFilters(providerResponse.normalized, input);
    });

    for (const filteredRows of searchResponses) {
      for (const row of filteredRows) {
        const normalizedCnpj = normalizeCnpj(row.cnpj);
        if (!normalizedCnpj || aggregatedByCnpj.has(normalizedCnpj)) continue;
        aggregatedByCnpj.set(normalizedCnpj, { ...row, cnpj: normalizedCnpj });
      }
    }

    const allRows = Array.from(aggregatedByCnpj.values());
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
      filterLabels: buildPublicFilterLabels(input)
    };

    const representativeLocation =
      searchTargets.find((item) => item.cityName.trim().length > 0) ??
      citySelections[0] ??
      {
        cityName: input.stateWide ? "Busca estadual" : "Brasil",
        stateCode: stateCodes[0] ?? "BR"
      };
    const cacheKey = sha256(JSON.stringify({ provider, email, queryPayload }));

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
      totalResults: allRows.length
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
    companySizes: input.companySizes ?? [],
    simplesOnly: input.simplesOnly ?? false,
    capitalSocialMin: input.capitalSocialMin ?? null,
    capitalSocialMax: input.capitalSocialMax ?? null
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
      companySizes: input.companySizes,
      simplesOnly: input.simplesOnly,
      capitalSocialMin: input.capitalSocialMin,
      capitalSocialMax: input.capitalSocialMax
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
        ? (cached.normalized_payload as typeof normalizedRows)
        : [];
      cachedHit = true;
    } else {
      const providerResponse =
        provider === "casadosdados"
          ? await searchWithCasaDosDados(normalizedInput)
          : provider === "hybrid"
            ? await searchWithHybrid(normalizedInput)
            : await searchWithCnpjWs(normalizedInput);

      raw = providerResponse.raw;
      normalizedRows = providerResponse.normalized;

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

    const cleanRows = normalizedRows
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
