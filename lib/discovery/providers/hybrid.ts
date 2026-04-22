import { DiscoverySearchInput, DiscoverySearchOutput, NormalizedEstablishment } from "@/lib/types";
import { normalizeCnpj } from "@/lib/utils";
import { searchWithCasaDosDados } from "./casadosdados";
import { fetchCnpjWsCompanyByCnpj } from "./cnpjws";

function pickFirstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickFirstDefined<T>(...values: Array<T | null | undefined>) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function mergeSecondaryCnaes(base: unknown, detail: unknown) {
  if (Array.isArray(detail) && detail.length > 0) return detail;
  if (Array.isArray(base) && base.length > 0) return base;
  return detail ?? base ?? null;
}

function isMobileLikePhone(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return false;
  const subscriber = digits.length >= 9 ? digits.slice(-9) : digits;
  const first = subscriber.charAt(0);
  return ["9", "8", "7"].includes(first);
}

function pickBestPhone(detailPhone?: string | null, searchPhone?: string | null) {
  if (isMobileLikePhone(detailPhone)) return detailPhone ?? null;
  if (isMobileLikePhone(searchPhone)) return searchPhone ?? null;
  return pickFirstNonEmpty(detailPhone, searchPhone);
}

function mergeProviderPayload(searchPayload: unknown, detailPayload?: unknown, detailError?: string | null) {
  return {
    casadosdados_pesquisa: searchPayload ?? null,
    cnpjws_consulta: detailPayload ?? null,
    erro_enriquecimento_cnpjws: detailError ?? null
  };
}

function mergeNormalizedEstablishment(
  searchRow: NormalizedEstablishment,
  detailRow?: NormalizedEstablishment | null,
  detailRaw?: unknown,
  detailError?: string | null
): NormalizedEstablishment {
  if (!detailRow) {
    return {
      ...searchRow,
      providerPayload: mergeProviderPayload(searchRow.providerPayload, detailRaw, detailError)
    };
  }

  return {
    cnpj: detailRow.cnpj || searchRow.cnpj,
    cnpjRoot: pickFirstNonEmpty(detailRow.cnpjRoot, searchRow.cnpjRoot),
    companyName: pickFirstNonEmpty(detailRow.companyName, searchRow.companyName) ?? searchRow.companyName,
    tradeName: pickFirstNonEmpty(detailRow.tradeName, searchRow.tradeName),
    registrationStatus: pickFirstNonEmpty(detailRow.registrationStatus, searchRow.registrationStatus),
    openedAt: pickFirstNonEmpty(detailRow.openedAt, searchRow.openedAt),
    primaryCnaeCode: pickFirstNonEmpty(detailRow.primaryCnaeCode, searchRow.primaryCnaeCode),
    primaryCnaeDescription: pickFirstNonEmpty(detailRow.primaryCnaeDescription, searchRow.primaryCnaeDescription),
    secondaryCnaes: mergeSecondaryCnaes(searchRow.secondaryCnaes, detailRow.secondaryCnaes),
    legalNatureCode: pickFirstNonEmpty(detailRow.legalNatureCode, searchRow.legalNatureCode),
    legalNatureDescription: pickFirstNonEmpty(detailRow.legalNatureDescription, searchRow.legalNatureDescription),
    companySize: pickFirstNonEmpty(detailRow.companySize, searchRow.companySize),
    simplesOptIn: pickFirstDefined(detailRow.simplesOptIn, searchRow.simplesOptIn),
    meiOptIn: pickFirstDefined(detailRow.meiOptIn, searchRow.meiOptIn),
    capitalSocial: pickFirstDefined(detailRow.capitalSocial, searchRow.capitalSocial),
    email: pickFirstNonEmpty(detailRow.email, searchRow.email),
    phone: pickBestPhone(detailRow.phone, searchRow.phone),
    website: pickFirstNonEmpty(detailRow.website, searchRow.website),
    country: pickFirstNonEmpty(detailRow.country, searchRow.country),
    stateCode: pickFirstNonEmpty(detailRow.stateCode, searchRow.stateCode),
    cityName: pickFirstNonEmpty(detailRow.cityName, searchRow.cityName),
    cityIbge: pickFirstNonEmpty(detailRow.cityIbge, searchRow.cityIbge),
    neighborhood: pickFirstNonEmpty(detailRow.neighborhood, searchRow.neighborhood),
    cep: pickFirstNonEmpty(detailRow.cep, searchRow.cep),
    addressLine: pickFirstNonEmpty(detailRow.addressLine, searchRow.addressLine),
    addressNumber: pickFirstNonEmpty(detailRow.addressNumber, searchRow.addressNumber),
    complement: pickFirstNonEmpty(detailRow.complement, searchRow.complement),
    providerPayload: mergeProviderPayload(searchRow.providerPayload, detailRaw, detailError)
  };
}

async function enrichWithCnpjWs(rows: NormalizedEstablishment[]) {
  const normalizedRows = rows.map((row) => ({
    ...row,
    cnpj: normalizeCnpj(row.cnpj)
  }));

  const enriched = new Array<NormalizedEstablishment>(normalizedRows.length);
  const limit = Math.max(1, Math.min(3, normalizedRows.length || 1));
  let cursor = 0;
  let successCount = 0;
  let authLikeFailure: Error | null = null;

  async function worker() {
    while (cursor < normalizedRows.length) {
      const index = cursor;
      cursor += 1;
      const current = normalizedRows[index];

      try {
        const detail = await fetchCnpjWsCompanyByCnpj(current.cnpj);
        if (detail.normalized) {
          successCount += 1;
        }
        enriched[index] = mergeNormalizedEstablishment(current, detail.normalized, detail.raw, null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao enriquecer com a CNPJ.ws.";
        if (/\b(401|403)\b/.test(message) || /x_api_token|token/i.test(message)) {
          authLikeFailure = error instanceof Error ? error : new Error(message);
        }
        enriched[index] = mergeNormalizedEstablishment(current, null, null, message);
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));

  if (normalizedRows.length > 0 && successCount === 0 && authLikeFailure) {
    throw authLikeFailure;
  }

  return enriched;
}

export async function searchWithHybrid(input: DiscoverySearchInput): Promise<DiscoverySearchOutput> {
  const casaResponse = await searchWithCasaDosDados(input);
  const enrichedRows = await enrichWithCnpjWs(casaResponse.normalized);
  const mergedByCnpj = new Map<string, NormalizedEstablishment>();
  for (const row of enrichedRows) {
    const cnpj = normalizeCnpj(row.cnpj);
    if (!cnpj) continue;
    mergedByCnpj.set(cnpj, { ...row, cnpj });
  }
  const mergedResults = Array.from(mergedByCnpj.values());

  return {
    provider: "hybrid",
    raw: {
      motor_principal: "casadosdados",
      complemento: "cnpjws",
      pesquisa: casaResponse.raw,
      resultados_enriquecidos: mergedResults.map((item) => item.providerPayload),
      provider_total_resultados: casaResponse.providerTotalResults ?? null,
      resultados_carregados: casaResponse.fetchedResults ?? null,
      resultados_unicos_merge: mergedResults.length
    },
    normalized: mergedResults,
    providerTotalResults: casaResponse.providerTotalResults ?? null,
    fetchedResults: casaResponse.fetchedResults ?? mergedResults.length,
    pagesFetched: casaResponse.pagesFetched ?? null,
    hitFetchLimit: casaResponse.hitFetchLimit ?? false
  };
}

export async function fetchHybridCompanyByCnpj(cnpj: string) {
  const detail = await fetchCnpjWsCompanyByCnpj(cnpj);

  return {
    raw: mergeProviderPayload(null, detail.raw, null),
    normalized: detail.normalized
      ? {
          ...detail.normalized,
          providerPayload: mergeProviderPayload(null, detail.raw, null)
        }
      : null
  };
}
