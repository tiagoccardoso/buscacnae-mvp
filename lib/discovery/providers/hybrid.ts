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
  if (Array.isArray(base) && base.length > 0) return base;
  if (Array.isArray(detail) && detail.length > 0) return detail;
  return base ?? detail ?? null;
}

function sanitizeEnrichmentError(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha ao enriquecer com a CNPJ.ws.";
  if (/abort/i.test(message)) return "CNPJ.ws não respondeu dentro do tempo limite.";
  const status = message.match(/CNPJ\.ws respondeu\s+(\d{3})/i)?.[1];
  if (status) return `CNPJ.ws respondeu ${status}.`;
  if (/missing environment variable: cnpjws_api_token/i.test(message)) return "CNPJ.ws sem configuração de token.";
  if (/x_api_token|token/i.test(message)) return "Falha de autenticação na CNPJ.ws.";
  return "Falha ao enriquecer com a CNPJ.ws.";
}

function logCnpjWsEnrichmentFailure(cnpj: string, error: unknown) {
  const status = error instanceof Error ? error.message.match(/CNPJ\.ws respondeu\s+(\d{3})/i)?.[1] : undefined;
  console.warn("[discovery:hybrid] enriquecimento CNPJ.ws ignorado", {
    cnpjSuffix: normalizeCnpj(cnpj).slice(-4) || null,
    status: status ?? null,
    reason: sanitizeEnrichmentError(error)
  });
}

function mergeProviderPayload(searchPayload: unknown, detailPayload?: unknown, detailError?: string | null) {
  const casaPayload = searchPayload && typeof searchPayload === "object" && !Array.isArray(searchPayload)
    ? searchPayload as Record<string, unknown>
    : null;

  return {
    casadosdados_pesquisa: casaPayload?.casadosdados_pesquisa ?? searchPayload ?? null,
    casadosdados_detalhe: casaPayload?.casadosdados_detalhe ?? null,
    erro_enriquecimento_casadosdados: casaPayload?.erro_enriquecimento_casadosdados ?? null,
    cnpjws_consulta: detailPayload ?? null,
    enriquecimento_cnpjws_status: detailError ? "falhou" : detailPayload ? "sucesso" : "nao_executado",
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
    cnpj: normalizeCnpj(searchRow.cnpj) || normalizeCnpj(detailRow.cnpj),
    cnpjRoot: pickFirstNonEmpty(searchRow.cnpjRoot, detailRow.cnpjRoot),
    companyName: pickFirstNonEmpty(searchRow.companyName, detailRow.companyName) ?? searchRow.companyName,
    tradeName: pickFirstNonEmpty(searchRow.tradeName, detailRow.tradeName),
    registrationStatus: pickFirstNonEmpty(searchRow.registrationStatus, detailRow.registrationStatus),
    openedAt: pickFirstNonEmpty(searchRow.openedAt, detailRow.openedAt),
    primaryCnaeCode: pickFirstNonEmpty(searchRow.primaryCnaeCode, detailRow.primaryCnaeCode),
    primaryCnaeDescription: pickFirstNonEmpty(searchRow.primaryCnaeDescription, detailRow.primaryCnaeDescription),
    secondaryCnaes: mergeSecondaryCnaes(searchRow.secondaryCnaes, detailRow.secondaryCnaes),
    legalNatureCode: pickFirstNonEmpty(searchRow.legalNatureCode, detailRow.legalNatureCode),
    legalNatureDescription: pickFirstNonEmpty(searchRow.legalNatureDescription, detailRow.legalNatureDescription),
    companySize: pickFirstNonEmpty(searchRow.companySize, detailRow.companySize),
    simplesOptIn: pickFirstDefined(searchRow.simplesOptIn, detailRow.simplesOptIn),
    meiOptIn: pickFirstDefined(searchRow.meiOptIn, detailRow.meiOptIn),
    capitalSocial: pickFirstDefined(searchRow.capitalSocial, detailRow.capitalSocial),
    email: pickFirstNonEmpty(searchRow.email, detailRow.email),
    phone: pickFirstNonEmpty(searchRow.phone, detailRow.phone),
    website: pickFirstNonEmpty(searchRow.website, detailRow.website),
    country: pickFirstNonEmpty(searchRow.country, detailRow.country),
    stateCode: pickFirstNonEmpty(searchRow.stateCode, detailRow.stateCode),
    cityName: pickFirstNonEmpty(searchRow.cityName, detailRow.cityName),
    cityIbge: pickFirstNonEmpty(searchRow.cityIbge, detailRow.cityIbge),
    neighborhood: pickFirstNonEmpty(searchRow.neighborhood, detailRow.neighborhood),
    cep: pickFirstNonEmpty(searchRow.cep, detailRow.cep),
    addressLine: pickFirstNonEmpty(searchRow.addressLine, detailRow.addressLine),
    addressNumber: pickFirstNonEmpty(searchRow.addressNumber, detailRow.addressNumber),
    complement: pickFirstNonEmpty(searchRow.complement, detailRow.complement),
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
  let failureCount = 0;

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
        failureCount += 1;
        const message = sanitizeEnrichmentError(error);
        logCnpjWsEnrichmentFailure(current.cnpj, error);
        enriched[index] = mergeNormalizedEstablishment(current, null, null, message);
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));

  return {
    rows: enriched.map((row, index) => row ?? normalizedRows[index]),
    successCount,
    failureCount
  };
}

export async function searchWithHybrid(input: DiscoverySearchInput): Promise<DiscoverySearchOutput> {
  const casaResponse = await searchWithCasaDosDados(input);
  const enrichment = await enrichWithCnpjWs(casaResponse.normalized);
  const mergedByCnpj = new Map<string, NormalizedEstablishment>();
  for (const row of enrichment.rows) {
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
      enriquecimento_cnpjws: {
        status:
          casaResponse.normalized.length === 0
            ? "nao_executado"
            : enrichment.failureCount === 0
              ? "sucesso"
              : enrichment.successCount > 0
                ? "parcial"
                : "falhou",
        sucessos: enrichment.successCount,
        falhas: enrichment.failureCount
      },
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
