import { getCnpjWsToken, getDiscoveryMaxResults } from "@/lib/env";
import { DiscoverySearchInput, DiscoverySearchOutput, NormalizedEstablishment } from "@/lib/types";
import {
  coalesceArray,
  coalesceObject,
  coalesceString,
  normalizeCnpj,
  normalizeCode,
  parseBoolean,
  parseNumber,
  toTitleCase
} from "@/lib/utils";
import { resolveCityIbge } from "./ibge";


function buildActivityStartDate(year: number | null | undefined) {
  if (!year || !Number.isInteger(year)) return null;
  return `${year}-01-01`;
}

function mapCnpjWsCompanySizes(values: string[] | undefined) {
  if (!values || values.length === 0) return [] as string[];

  const mapped = values.map((value) => {
    const normalized = value
      .trim()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

    if (normalized.includes("micro")) return "02";
    if (normalized.includes("pequeno")) return "03";
    if (normalized.includes("demais")) return "05";
    return null;
  }).filter((value): value is "02" | "03" | "05" => value !== null);

  return Array.from(new Set(mapped));
}


function hasAdvancedCnpjWsFilters(input: DiscoverySearchInput) {
  return Boolean(
    input.requireEmail ||
    input.requireAddress ||
    input.requirePhone ||
    input.mobileOnly ||
    input.simplesOnly ||
    (input.companySizes?.length ?? 0) > 0 ||
    input.capitalSocialMin !== null && input.capitalSocialMin !== undefined ||
    input.capitalSocialMax !== null && input.capitalSocialMax !== undefined ||
    input.activityStartYear !== null && input.activityStartYear !== undefined
  );
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

function formatPhone(ddd: string | null, number: string | null) {
  const normalizedDdd = (ddd ?? "").replace(/\D/g, "");
  const normalizedNumber = (number ?? "").replace(/\D/g, "");
  if (!normalizedNumber) return null;
  return normalizedDdd ? `(${normalizedDdd}) ${normalizedNumber}` : normalizedNumber;
}

function isMobileLikePhone(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return false;
  const subscriber = digits.length >= 9 ? digits.slice(-9) : digits;
  return ["9", "8", "7"].includes(subscriber.charAt(0));
}

function coerceText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickFirstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractFirstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractFirstString(item);
      if (nested) return nested;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const formattedPhone = formatPhone(coalesceString(record.ddd), coalesceString(record.numero));
    if (formattedPhone) return formattedPhone;

    for (const key of ["email", "completo", "telefone", "valor", "site", "url", "descricao", "nome"]) {
      const nested = extractFirstString(record[key]);
      if (nested) return nested;
    }
  }

  return null;
}

function normalizeFromCnpjWs(item: Record<string, unknown>): NormalizedEstablishment | null {
  const company = coalesceObject(item.consulta_cnpj, item.cnpjws_consulta, item);
  const searchPreview = coalesceObject(item.pesquisa, item.search);
  const registrationStatus = coalesceObject(
    company?.situacao_cadastral,
    searchPreview?.situacao_cadastral,
    item.situacao_cadastral
  );
  const activity = coalesceObject(
    company?.atividade_principal,
    company?.atividadePrincipal,
    item.atividade_principal,
    item.atividadePrincipal
  );
  const address = coalesceObject(company?.endereco, company?.estabelecimento, item.endereco, item.estabelecimento, item.establishment);
  const addressIbge = coalesceObject(address?.ibge, company?.ibge, item.ibge);
  const city = coalesceObject(address?.cidade, company?.cidade, item.cidade);
  const state = coalesceObject(address?.estado, company?.estado, item.estado);
  const country = coalesceObject(address?.pais, company?.pais, item.pais);
  const legalNature = coalesceObject(company?.natureza_juridica, item.natureza_juridica);
  const companySize = coalesceObject(company?.porte_empresa, company?.porte, item.porte);
  const simples = coalesceObject(company?.simples, item.simples);
  const mei = coalesceObject(company?.mei, item.mei);

  const cnpj = normalizeCnpj(
    coalesceString(company?.cnpj, searchPreview?.cnpj, item.cnpj, address?.cnpj, address?.cnpj_completo) ?? ""
  );
  if (!cnpj) return null;

  const phone1 = formatPhone(
    coalesceString(company?.ddd1, address?.ddd1, item.ddd1),
    coalesceString(company?.telefone1, address?.telefone1, item.telefone1)
  );
  const phone2 = formatPhone(
    coalesceString(company?.ddd2, address?.ddd2, item.ddd2),
    coalesceString(company?.telefone2, address?.telefone2, item.telefone2)
  );
  const fax = formatPhone(
    coalesceString(company?.ddd_fax, address?.ddd_fax, item.ddd_fax),
    coalesceString(company?.fax, address?.fax, item.fax)
  );
  const contactPhone = extractFirstString(company?.contato_telefonico ?? item.contato_telefonico);
  const primaryPhone = isMobileLikePhone(phone1)
    ? phone1
    : isMobileLikePhone(phone2)
      ? phone2
      : pickFirstNonEmpty(
          phone1,
          phone2,
          fax,
          contactPhone,
          coalesceString(company?.telefone, address?.telefone, item.telefone)
        );

  return {
    cnpj,
    cnpjRoot: normalizeCode(coerceText(company?.cnpj_raiz, searchPreview?.cnpj_raiz, item.cnpj_raiz, address?.cnpj_raiz) ?? ""),
    companyName:
      pickFirstNonEmpty(
        coalesceString(company?.razao_social),
        coalesceString(searchPreview?.razao_social),
        coalesceString(company?.nome),
        coalesceString(searchPreview?.nome),
        coalesceString(item.razao_social),
        coalesceString(item.nome)
      ) ?? "Sem razão social",
    tradeName: coalesceString(company?.nome_fantasia, searchPreview?.nome_fantasia, item.nome_fantasia),
    registrationStatus: pickFirstNonEmpty(
      coalesceString(registrationStatus?.situacao_atual),
      coalesceString(company?.situacao),
      coalesceString(company?.situacao_cadastral),
      coalesceString(item.situacao_cadastral)
    ),
    openedAt: coalesceString(company?.data_abertura, company?.data_inicio_atividade, item.data_abertura, item.data_inicio_atividade),
    primaryCnaeCode: normalizeCode(
      coerceText(
        activity?.id,
        activity?.codigo,
        company?.cnae_fiscal_principal_id,
        company?.codigo_atividade_principal,
        item.atividade_principal_id
      ) ?? ""
    ),
    primaryCnaeDescription: coalesceString(
      activity?.descricao,
      activity?.text,
      company?.atividade_principal_descricao,
      item.atividade_principal_descricao
    ),
    secondaryCnaes: coalesceArray(company?.atividade_secundaria, company?.atividades_secundarias, item.atividades_secundarias),
    legalNatureCode: normalizeCode(
      coerceText(legalNature?.id, company?.codigo_natureza_juridica, item.natureza_juridica_id, address?.natureza_juridica_id) ?? ""
    ),
    legalNatureDescription: coalesceString(
      company?.descricao_natureza_juridica,
      legalNature?.descricao,
      item.natureza_juridica
    ),
    companySize: coalesceString(companySize?.descricao, company?.porte, item.porte),
    simplesOptIn: parseBoolean(company?.simples_optante ?? simples?.optante ?? simples?.simples ?? item.simples_optante),
    meiOptIn: parseBoolean(company?.mei_optante ?? mei?.optante ?? mei?.mei ?? item.mei_optante),
    capitalSocial: parseNumber(company?.capital_social ?? item.capital_social),
    email: pickFirstNonEmpty(
      coalesceString(company?.email, item.email),
      extractFirstString(company?.contato_email),
      extractFirstString(item.contato_email)
    ),
    phone: primaryPhone,
    website: pickFirstNonEmpty(
      coalesceString(company?.website, company?.site, item.website, item.site),
      extractFirstString(company?.contato_site),
      extractFirstString(item.contato_site)
    ),
    country: coalesceString(country?.nome, company?.pais_nome, item.pais_nome),
    stateCode: coalesceString(address?.uf, company?.uf, state?.sigla, item.uf)?.toUpperCase() ?? null,
    cityName: coalesceString(address?.municipio, company?.municipio, city?.nome, item.cidade_nome, item.cidade) ?? null,
    cityIbge: normalizeCode(
      coerceText(
        addressIbge?.codigo_municipio,
        city?.ibge_id,
        city?.id,
        company?.codigo_municipio_ibge,
        company?.cidade_id,
        item.cidade_id,
        item.codigo_municipio_ibge
      ) ?? ""
    ),
    neighborhood: coalesceString(address?.bairro, company?.bairro, item.bairro),
    cep: normalizeCode(coalesceString(address?.cep, company?.cep, item.cep) ?? ""),
    addressLine: coalesceString(
      address?.tipo_logradouro && address?.logradouro
        ? `${String(address.tipo_logradouro)} ${String(address.logradouro)}`.trim()
        : null,
      address?.logradouro,
      company?.logradouro,
      item.logradouro
    ),
    addressNumber: coalesceString(address?.numero, company?.numero, item.numero),
    complement: coalesceString(address?.complemento, company?.complemento, item.complemento),
    providerPayload: item
  };
}

export async function fetchCnpjWsCompanyByCnpj(cnpj: string): Promise<{
  raw: Record<string, unknown>;
  normalized: NormalizedEstablishment | null;
}> {
  const normalizedCnpj = normalizeCnpj(cnpj);
  if (!normalizedCnpj) {
    throw new Error("CNPJ inválido para consulta detalhada na CNPJ.ws.");
  }

  const response = await fetch(`https://comercial.cnpj.ws/cnpj/${normalizedCnpj}`, {
    headers: {
      x_api_token: getCnpjWsToken(),
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`CNPJ.ws respondeu ${response.status}: ${message}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const normalized = normalizeFromCnpjWs(raw);

  return {
    raw,
    normalized: normalized
      ? {
          ...normalized,
          cityName: normalized.cityName ? toTitleCase(normalized.cityName) : normalized.cityName
        }
      : null
  };
}

export async function searchWithCnpjWs(input: DiscoverySearchInput): Promise<DiscoverySearchOutput> {
  let cityIbge = input.cityIbge?.trim();

  if (!cityIbge && input.cityName && input.stateCode) {
    cityIbge = await resolveCityIbge({
      cityName: input.cityName,
      stateCode: input.stateCode
    });
  }

  const params = new URLSearchParams({
    atividade_id: normalizeCode(input.cnae),
    situacao_cadastral: "ATIVA"
  });

  if (cityIbge) {
    params.set("cidade_id", normalizeCode(cityIbge));
  }

  const maxResults = getDiscoveryMaxResults();
  if (maxResults > 0) {
    const requestedLimit = hasAdvancedCnpjWsFilters(input)
      ? Math.min(Math.max(maxResults * 3, maxResults), 250)
      : Math.min(maxResults, 100);
    params.set("limite", String(requestedLimit));
  }

  const mappedSizes = mapCnpjWsCompanySizes(input.companySizes);
  if (mappedSizes.length === 1) {
    params.set("porte_id", mappedSizes[0] ?? "");
  }

  const openedAtDate = buildActivityStartDate(input.activityStartYear ?? null);
  if (openedAtDate) {
    params.set("data_inicio_atividade_de", openedAtDate);
  }

  const response = await fetch(`https://comercial.cnpj.ws/v2/pesquisa?${params.toString()}`, {
    headers: {
      x_api_token: getCnpjWsToken(),
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`CNPJ.ws respondeu ${response.status}: ${message}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const rows = coalesceArray(raw.registros, raw.itens, raw.resultados, raw.empresas) ?? [];
  const directNormalized = rows
    .map((item) => normalizeFromCnpjWs(item as Record<string, unknown>))
    .filter(Boolean) as NormalizedEstablishment[];

  const cnpjList = Array.isArray(raw.data)
    ? raw.data
        .map((item) => typeof item === "string" ? normalizeCnpj(item) : "")
        .filter(Boolean)
    : [];

  let normalized = directNormalized;

  if (normalized.length === 0 && cnpjList.length > 0) {
    const detailedRows = await mapWithConcurrency(cnpjList, 3, async (cnpj) => {
      try {
        const detail = await fetchCnpjWsCompanyByCnpj(cnpj);
        if (!detail.normalized) return null;
        return {
          ...detail.normalized,
          providerPayload: {
            pesquisa: raw,
            consulta_cnpj: detail.raw
          }
        } as NormalizedEstablishment;
      } catch {
        return null;
      }
    });

    normalized = detailedRows.filter((item): item is NormalizedEstablishment => Boolean(item));
  }

  return {
    provider: "cnpjws",
    raw,
    normalized: normalized.map((item) => ({
      ...item,
      cityName: item.cityName ? toTitleCase(item.cityName) : item.cityName
    })),
    providerTotalResults: null,
    fetchedResults: normalized.length,
    pagesFetched: null,
    hitFetchLimit: false
  };
}
