import { getCasaDosDadosKey, getDiscoveryMaxResults, getDiscoveryPageSize } from "@/lib/env";
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


function mapCasaDosDadosCompanySizes(values: string[] | undefined) {
  if (!values || values.length === 0) return [] as string[];

  const mapped = values.map((value) => {
    const normalized = value
      .trim()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

    if (normalized.includes("micro")) return "MICRO EMPRESA";
    if (normalized.includes("pequeno")) return "EMPRESA DE PEQUENO PORTE";
    if (normalized.includes("medio")) return "MEDIO PORTE";
    if (normalized.includes("grande")) return "GRANDE PORTE";
    if (normalized.includes("demais")) return "DEMAIS";
    return value.trim().toUpperCase();
  }).filter(Boolean);

  return Array.from(new Set(mapped));
}

function buildCasaDosDadosDateRange(year: number | null | undefined) {
  if (!year || !Number.isInteger(year)) return null;
  return { data_minima: `${year}-01-01` };
}

function buildCasaDosDadosCapitalRange(min: number | null | undefined, max: number | null | undefined) {
  if (min === null && max === null) return null;
  const range: Record<string, number> = {};
  if (typeof min === "number" && Number.isFinite(min)) range.valor_minimo = min;
  if (typeof max === "number" && Number.isFinite(max)) range.valor_maximo = max;
  return Object.keys(range).length > 0 ? range : null;
}

function coalesceText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function extractNestedText(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return coalesceText(current);
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
    for (const key of ["valor", "telefone", "numero", "email", "endereco", "site", "url"]) {
      const nested = extractFirstString(record[key]);
      if (nested) return nested;
    }
  }
  return null;
}

export function normalizeCasaDosDadosEstablishment(
  item: Record<string, unknown>
): NormalizedEstablishment | null {
  const activity = coalesceObject(
    item.atividade_principal,
    item.cnae_principal,
    item.codigo_atividade_principal
  );
  const address = coalesceObject(item.endereco, item.address);
  const registrationStatus = coalesceObject(item.situacao_cadastral, item.status);
  const companySize = coalesceObject(item.porte_empresa, item.porte);
  const contacts = coalesceObject(item.contato, item.contatos);

  const cnpj = normalizeCnpj(
    coalesceString(item.cnpj, item.cnpj_completo, item.cnpj_formatado) ?? ""
  );
  if (!cnpj) return null;

  const typeLogradouro = coalesceText(address?.tipo_logradouro);
  const logradouro = coalesceText(address?.logradouro, item.logradouro);
  const addressLine =
    typeLogradouro && logradouro ? `${typeLogradouro} ${logradouro}` : logradouro;
  const addressIbge =
    address?.ibge && typeof address.ibge === "object" && !Array.isArray(address.ibge)
      ? (address.ibge as Record<string, unknown>)
      : null;

  return {
    cnpj,
    cnpjRoot: normalizeCode(coalesceText(item.cnpj_raiz) ?? ""),
    companyName:
      coalesceString(item.razao_social, item.nome_empresarial) ?? "Sem razão social",
    tradeName: coalesceString(item.nome_fantasia),
    registrationStatus: coalesceText(
      registrationStatus?.situacao_cadastral,
      registrationStatus?.descricao,
      item.situacao_cadastral,
      item.status
    ),
    openedAt: coalesceText(item.data_inicio_atividade, item.data_abertura, item.abertura),
    primaryCnaeCode: normalizeCode(
      coalesceText(
        item.codigo_atividade_principal,
        activity?.codigo,
        extractNestedText(activity, ["principal", "codigo"])
      ) ?? ""
    ),
    primaryCnaeDescription: coalesceText(
      item.atividade_principal_descricao,
      item.descricao_atividade_principal,
      activity?.descricao,
      extractNestedText(activity, ["principal", "descricao"]),
      typeof item.atividade_principal === "string" ? item.atividade_principal : null
    ),
    secondaryCnaes: coalesceArray(item.atividades_secundarias, item.codigo_atividade_secundaria),
    legalNatureCode: normalizeCode(coalesceText(item.codigo_natureza_juridica) ?? ""),
    legalNatureDescription: coalesceText(
      item.natureza_juridica,
      item.descricao_natureza_juridica
    ),
    companySize: coalesceText(item.porte, companySize?.descricao),
    simplesOptIn: parseBoolean(item.opcao_pelo_simples),
    meiOptIn: parseBoolean(item.opcao_pelo_mei),
    capitalSocial: parseNumber(item.capital_social),
    email:
      extractFirstString(item.email) ??
      extractFirstString(contacts?.email) ??
      extractFirstString(contacts?.emails),
    phone:
      extractFirstString(item.telefone) ??
      extractFirstString(item.telefone1) ??
      extractFirstString(contacts?.telefone) ??
      extractFirstString(contacts?.telefones),
    website:
      extractFirstString(item.website) ??
      extractFirstString(contacts?.website) ??
      extractFirstString(contacts?.site),
    country: coalesceText(item.pais),
    stateCode: coalesceText(item.uf, address?.uf)?.toUpperCase() ?? null,
    cityName: coalesceText(item.municipio, item.cidade, address?.municipio),
    cityIbge: normalizeCode(
      coalesceText(
        item.codigo_municipio_ibge,
        item.municipio_ibge,
        address?.codigo_municipio_ibge,
        address?.municipio_ibge,
        addressIbge?.codigo_municipio
      ) ?? ""
    ),
    neighborhood: coalesceText(item.bairro, address?.bairro),
    cep: normalizeCode(coalesceText(item.cep, address?.cep) ?? ""),
    addressLine,
    addressNumber: coalesceText(item.numero, address?.numero),
    complement: coalesceText(item.complemento, address?.complemento),
    providerPayload: item
  };
}

export async function fetchCasaDosDadosCompanyByCnpj(cnpj: string): Promise<{
  raw: Record<string, unknown>;
  normalized: NormalizedEstablishment | null;
}> {
  const normalizedCnpj = normalizeCnpj(cnpj);
  if (!normalizedCnpj) {
    throw new Error("CNPJ inválido para consulta detalhada na Casa dos Dados.");
  }

  const response = await fetch(
    `https://api.casadosdados.com.br/v4/cnpj/${normalizedCnpj}`,
    {
      method: "GET",
      headers: {
        "api-key": getCasaDosDadosKey(),
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Casa dos Dados respondeu ${response.status}: ${message}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;

  const normalized = normalizeCasaDosDadosEstablishment(raw);

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

export async function searchWithCasaDosDados(
  input: DiscoverySearchInput
): Promise<DiscoverySearchOutput> {
  const normalizedStateCode = input.stateCode.trim().toLowerCase();
  const normalizedCityName = input.cityName.trim().toLowerCase();

  const pageSize = Math.max(1, Math.trunc(getDiscoveryPageSize() || 50));
  const maxResults = Math.max(0, Math.trunc(getDiscoveryMaxResults() || 0));
  const body: Record<string, unknown> = {
    codigo_atividade_principal: [normalizeCode(input.cnae)],
    incluir_atividade_secundaria: false,
    situacao_cadastral: ["ATIVA"],
    pagina: 1,
    limite: pageSize
  };

  if (normalizedStateCode) {
    body.uf = [normalizedStateCode];
  }

  if (normalizedCityName) {
    body.municipio = [normalizedCityName];
  }

  const moreFilters: Record<string, boolean> = {};
  if (input.requireEmail) moreFilters.com_email = true;
  if (input.requirePhone || input.mobileOnly) moreFilters.com_telefone = true;
  if (input.mobileOnly) moreFilters.somente_celular = true;

  if (Object.keys(moreFilters).length > 0) {
    body.mais_filtros = moreFilters;
  }

  const companySizes = mapCasaDosDadosCompanySizes(input.companySizes);
  if (companySizes.length > 0) {
    body.porte_empresa = companySizes;
  }

  if (input.simplesOnly) {
    body.simples = true;
  }

  const capitalRange = buildCasaDosDadosCapitalRange(input.capitalSocialMin ?? null, input.capitalSocialMax ?? null);
  if (capitalRange) {
    body.capital_social = capitalRange;
  }

  const openedAtRange = buildCasaDosDadosDateRange(input.activityStartYear ?? null);
  if (openedAtRange) {
    body.data_abertura = openedAtRange;
  }

  const rawPages: Record<string, unknown>[] = [];
  const accumulatedRows: unknown[] = [];
  let providerTotalResults: number | null = null;
  let page = 1;
  let pagesFetched = 0;
  let hitFetchLimit = false;

  while (true) {
    const response = await fetch("https://api.casadosdados.com.br/v5/cnpj/pesquisa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": getCasaDosDadosKey(),
        Accept: "application/json"
      },
      body: JSON.stringify({
        ...body,
        pagina: page,
        limite: pageSize
      }),
      cache: "no-store"
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Casa dos Dados respondeu ${response.status}: ${message}`);
    }

    const rawPage = (await response.json()) as Record<string, unknown>;
    rawPages.push(rawPage);
    pagesFetched += 1;

    if (providerTotalResults === null) {
      const candidateTotals = [rawPage.total, rawPage.total_registros, rawPage.total_resultados];
      for (const candidate of candidateTotals) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          providerTotalResults = Math.max(0, Math.trunc(candidate));
          break;
        }
      }
    }

    const pageRows = coalesceArray(rawPage.registros, rawPage.cnpjs, rawPage.resultados, rawPage.data, rawPage) ?? [];
    if (pageRows.length === 0) {
      break;
    }

    accumulatedRows.push(...pageRows);

    if (maxResults > 0 && accumulatedRows.length >= maxResults) {
      hitFetchLimit = true;
      break;
    }

    if (providerTotalResults !== null && accumulatedRows.length >= providerTotalResults) {
      break;
    }

    page += 1;
  }

  const fetchedRows = (maxResults > 0 ? accumulatedRows.slice(0, maxResults) : accumulatedRows) as Record<string, unknown>[];
  const dedupedRows = Array.from(
    new Map(
      fetchedRows
        .map((item) => {
          const cnpj = normalizeCnpj(coalesceString(item.cnpj, item.cnpj_completo, item.cnpj_formatado) ?? "");
          return cnpj ? [cnpj, item] as const : null;
        })
        .filter((item): item is readonly [string, Record<string, unknown>] => Boolean(item))
    ).values()
  );

  const normalized = dedupedRows
    .map((item) => normalizeCasaDosDadosEstablishment(item as Record<string, unknown>))
    .filter(Boolean) as NormalizedEstablishment[];

  return {
    provider: "casadosdados",
    raw: rawPages.length === 1 ? rawPages[0] : { paginas: rawPages },
    normalized: normalized.map((item) => ({
      ...item,
      cityName: item.cityName ? toTitleCase(item.cityName) : item.cityName
    })),
    providerTotalResults,
    fetchedResults: normalized.length,
    pagesFetched,
    hitFetchLimit
  };
}
