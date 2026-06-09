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


type CasaDosDadosFieldSource = Record<string, unknown>;

function mapCasaDosDadosCompanySizes(values: string[] | undefined) {
  if (!values || values.length === 0) return [] as string[];

  const mapped = values.map((value) => {
    const normalized = value
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    if (!normalized) return null;
    if (/(^| )mei( |$)|microempreendedor individual|micro/.test(normalized)) return "01";
    if (/pequeno|epp/.test(normalized)) return "03";
    if (/medio|m[eé]dio|grande|demais/.test(value.toLowerCase()) || /medio|grande|demais/.test(normalized)) return "05";
    return value.trim().toUpperCase();
  }).filter((value): value is string => Boolean(value));

  return Array.from(new Set(mapped));
}

function buildCasaDosDadosDateRange(year: number | null | undefined, exactYear = false) {
  if (!year || !Number.isInteger(year)) return null;
  if (!exactYear) return { inicio: `${year}-01-01` };
  return { inicio: `${year}-01-01`, fim: `${year}-12-31` };
}

function buildCasaDosDadosCapitalRange(min: number | null | undefined, max: number | null | undefined) {
  if (min === null && max === null) return null;
  const range: Record<string, number> = {};
  if (typeof min === "number" && Number.isFinite(min)) range.minimo = min;
  if (typeof max === "number" && Number.isFinite(max)) range.maximo = max;
  return Object.keys(range).length > 0 ? range : null;
}

function coalesceText(...values: unknown[]) {
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

function pickFirstDefined<T>(...values: Array<T | null | undefined>) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
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

function pickBestPhone(primary?: string | null, secondary?: string | null) {
  if (isMobileLikePhone(primary)) return primary ?? null;
  if (isMobileLikePhone(secondary)) return secondary ?? null;
  return pickFirstNonEmpty(primary, secondary);
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
    const formattedPhone = formatPhone(
      coalesceString(record.ddd, record.DDD, record.codigo_ddd),
      coalesceString(record.numero, record.telefone, record.valor, record.completo)
    );
    if (formattedPhone) return formattedPhone;

    for (const key of ["email", "e_mail", "mail", "completo", "telefone", "phone", "celular", "whatsapp", "numero", "valor", "endereco", "site", "url", "descricao", "nome"]) {
      const nested = extractFirstString(record[key]);
      if (nested) return nested;
    }
  }
  return null;
}

function extractRecordSources(item: Record<string, unknown>) {
  const nestedCandidates = [
    item.estabelecimento,
    item.empresa,
    item.consulta_cnpj,
    item.cnpj,
    item.dados_cnpj,
    item.dados,
    item.data,
    item.resultado,
    item.result,
    item.payload,
    item.establishment,
    item.dados_cadastrais
  ]
    .map((value) => coalesceObject(value))
    .filter((value): value is CasaDosDadosFieldSource => Boolean(value));

  return [item, ...nestedCandidates];
}

function firstTextFromSources(sources: CasaDosDadosFieldSource[], ...keys: string[]) {
  for (const source of sources) {
    for (const key of keys) {
      const value = coalesceText(source[key]);
      if (value) return value;
    }
  }
  return null;
}

function firstStringFromSources(sources: CasaDosDadosFieldSource[], ...keys: string[]) {
  for (const source of sources) {
    for (const key of keys) {
      const value = extractFirstString(source[key]);
      if (value) return value;
    }
  }
  return null;
}

function firstObjectFromSources(sources: CasaDosDadosFieldSource[], ...keys: string[]) {
  for (const source of sources) {
    for (const key of keys) {
      const value = coalesceObject(source[key]);
      if (value) return value;
    }
  }
  return null;
}

function firstArrayFromSources(sources: CasaDosDadosFieldSource[], ...keys: string[]) {
  for (const source of sources) {
    for (const key of keys) {
      const value = coalesceArray(source[key]);
      if (value && value.length > 0) return value;
    }
  }
  return null;
}

function resolvePhoneFromSources(sources: CasaDosDadosFieldSource[]) {
  for (const source of sources) {
    const phone1 = formatPhone(
      coalesceText(source.ddd1, source.ddd_1, source.ddd_telefone_1, source.dddTelefone1),
      coalesceText(source.telefone1, source.telefone_1, source.telefone_primario, source.numero_telefone_1)
    );
    const phone2 = formatPhone(
      coalesceText(source.ddd2, source.ddd_2, source.ddd_telefone_2, source.dddTelefone2),
      coalesceText(source.telefone2, source.telefone_2, source.telefone_secundario, source.numero_telefone_2)
    );
    const contactPhone = firstStringFromSources([source], "contato_telefonico", "telefones", "telefone", "phone", "celular", "whatsapp");
    const best = pickBestPhone(phone1, pickBestPhone(phone2, contactPhone));
    if (best) return best;
  }

  return null;
}


function resolveEmailFromSources(sources: CasaDosDadosFieldSource[], contacts: Record<string, unknown> | null) {
  return pickFirstNonEmpty(
    firstStringFromSources(sources, "contato_email", "emails", "email", "e_mail", "correio_eletronico", "mail"),
    extractFirstString(contacts?.email),
    extractFirstString(contacts?.emails),
    extractFirstString(contacts?.contato_email),
    extractFirstString(contacts?.mail)
  );
}

function resolveWebsiteFromSources(sources: CasaDosDadosFieldSource[], contacts: Record<string, unknown> | null) {
  return pickFirstNonEmpty(
    firstStringFromSources(sources, "website", "site", "url", "contato_site", "homepage"),
    extractFirstString(contacts?.website),
    extractFirstString(contacts?.site),
    extractFirstString(contacts?.url)
  );
}

function resolveAddressLine(item: Record<string, unknown>, sources: CasaDosDadosFieldSource[], address: Record<string, unknown> | null) {
  const typeLogradouro = coalesceText(address?.tipo_logradouro, address?.tipo, firstTextFromSources(sources, "tipo_logradouro", "tipo"));
  const logradouro = coalesceText(
    address?.logradouro,
    address?.tipo_e_logradouro,
    firstTextFromSources(sources, "logradouro", "address_line", "endereco_logradouro")
  );
  const directAddressText = typeof item.endereco === "string" ? item.endereco : firstTextFromSources(sources, "endereco_completo", "address", "addressLine");

  if (typeLogradouro && logradouro) return `${typeLogradouro} ${logradouro}`.replace(/\s+/g, " ").trim();
  return logradouro ?? directAddressText;
}

function mergeSecondaryCnaes(base: unknown, detail: unknown) {
  if (Array.isArray(detail) && detail.length > 0) return detail;
  if (Array.isArray(base) && base.length > 0) return base;
  return detail ?? base ?? null;
}

function mergeProviderPayload(searchPayload: unknown, detailPayload?: unknown, detailError?: string | null) {
  return {
    casadosdados_pesquisa: searchPayload ?? null,
    casadosdados_detalhe: detailPayload ?? null,
    erro_enriquecimento_casadosdados: detailError ?? null
  };
}


function readNestedValue(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractCasaDosDadosRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  }

  if (!payload || typeof payload !== "object") return [];

  const direct = payload as Record<string, unknown>;
  const candidates = [
    direct.registros,
    direct.cnpjs,
    direct.resultados,
    direct.results,
    direct.items,
    direct.empresas,
    direct.estabelecimentos,
    direct.docs,
    direct.data,
    readNestedValue(direct, ["data", "registros"]),
    readNestedValue(direct, ["data", "cnpjs"]),
    readNestedValue(direct, ["data", "resultados"]),
    readNestedValue(direct, ["data", "results"]),
    readNestedValue(direct, ["data", "items"]),
    readNestedValue(direct, ["data", "empresas"]),
    readNestedValue(direct, ["data", "estabelecimentos"]),
    readNestedValue(direct, ["resultado", "registros"]),
    readNestedValue(direct, ["resultado", "cnpjs"]),
    readNestedValue(direct, ["resultado", "resultados"])
  ];

  for (const candidate of candidates) {
    const rows = coalesceArray(candidate);
    if (rows && rows.length > 0) {
      return rows.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
    }
  }

  return [];
}

function extractCasaDosDadosTotal(payload: unknown) {
  const candidates = [
    readNestedValue(payload, ["total"]),
    readNestedValue(payload, ["total_registros"]),
    readNestedValue(payload, ["total_resultados"]),
    readNestedValue(payload, ["count"]),
    readNestedValue(payload, ["data", "total"]),
    readNestedValue(payload, ["data", "total_registros"]),
    readNestedValue(payload, ["data", "total_resultados"]),
    readNestedValue(payload, ["data", "count"]),
    readNestedValue(payload, ["resultado", "total"]),
    readNestedValue(payload, ["paginacao", "total"]),
    readNestedValue(payload, ["pagination", "total"])
  ];

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (typeof parsed === "number" && Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return null;
}


function extractCasaDosDadosCnpj(item: Record<string, unknown>) {
  const sources = extractRecordSources(item);
  return normalizeCnpj(firstTextFromSources(sources, "cnpj", "cnpj_completo", "cnpj_formatado", "documento") ?? "");
}

async function readCasaDosDadosJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {} as Record<string, unknown>;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Casa dos Dados retornou uma resposta em formato inválido.");
  }
}

function mergeCasaDosDadosEstablishment(
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

export function normalizeCasaDosDadosEstablishment(
  item: Record<string, unknown>
): NormalizedEstablishment | null {
  const sources = extractRecordSources(item);
  const activity = firstObjectFromSources(
    sources,
    "atividade_principal",
    "cnae_principal",
    "codigo_atividade_principal"
  );
  const address = firstObjectFromSources(sources, "endereco", "address");
  const registrationStatus = firstObjectFromSources(sources, "situacao_cadastral", "status");
  const companySize = firstObjectFromSources(sources, "porte_empresa", "porte");
  const contacts = firstObjectFromSources(sources, "contato", "contatos", "contacts");

  const cnpj = normalizeCnpj(
    firstTextFromSources(sources, "cnpj", "cnpj_completo", "cnpj_formatado", "documento") ?? ""
  );
  if (!cnpj) return null;

  const addressIbge =
    address?.ibge && typeof address.ibge === "object" && !Array.isArray(address.ibge)
      ? (address.ibge as Record<string, unknown>)
      : null;

  return {
    cnpj,
    cnpjRoot: normalizeCode(firstTextFromSources(sources, "cnpj_raiz", "cnpjRoot", "raiz_cnpj") ?? ""),
    companyName:
      firstTextFromSources(sources, "razao_social", "nome_empresarial", "nome", "company_name") ?? "Sem razão social",
    tradeName: firstTextFromSources(sources, "nome_fantasia", "trade_name"),
    registrationStatus: coalesceText(
      registrationStatus?.situacao_cadastral,
      registrationStatus?.situacao_atual,
      registrationStatus?.descricao,
      firstTextFromSources(sources, "situacao_cadastral", "status", "situacao")
    ),
    openedAt: firstTextFromSources(sources, "data_abertura", "data_inicio_atividade", "abertura"),
    primaryCnaeCode: normalizeCode(
      coalesceText(
        firstTextFromSources(sources, "codigo_atividade_principal", "cnae_fiscal_principal"),
        activity?.codigo,
        activity?.id,
        extractNestedText(activity, ["principal", "codigo"])
      ) ?? ""
    ),
    primaryCnaeDescription: coalesceText(
      firstTextFromSources(sources, "atividade_principal_descricao", "descricao_atividade_principal", "cnae_fiscal_principal_descricao"),
      activity?.descricao,
      activity?.text,
      extractNestedText(activity, ["principal", "descricao"]),
      typeof firstTextFromSources(sources, "atividade_principal") === "string" ? firstTextFromSources(sources, "atividade_principal") : null
    ),
    secondaryCnaes: firstArrayFromSources(sources, "atividades_secundarias", "atividade_secundaria", "codigo_atividade_secundaria"),
    legalNatureCode: normalizeCode(firstTextFromSources(sources, "codigo_natureza_juridica", "natureza_juridica_id") ?? ""),
    legalNatureDescription: firstTextFromSources(
      sources,
      "natureza_juridica",
      "descricao_natureza_juridica",
      "legal_nature_description"
    ),
    companySize: coalesceText(firstTextFromSources(sources, "porte"), companySize?.descricao),
    simplesOptIn: parseBoolean(firstStringFromSources(sources, "opcao_pelo_simples", "simples_optante", "simples")),
    meiOptIn: parseBoolean(firstStringFromSources(sources, "opcao_pelo_mei", "mei_optante", "mei")),
    capitalSocial: parseNumber(firstStringFromSources(sources, "capital_social")),
    email: resolveEmailFromSources(sources, contacts),
    phone: pickBestPhone(
      resolvePhoneFromSources(sources),
      pickFirstNonEmpty(
        extractFirstString(contacts?.telefone),
        extractFirstString(contacts?.telefones),
        extractFirstString(contacts?.phone)
      )
    ),
    website: resolveWebsiteFromSources(sources, contacts),
    country: firstTextFromSources(sources, "pais", "pais_nome"),
    stateCode: coalesceText(firstTextFromSources(sources, "uf", "state_code"), address?.uf)?.toUpperCase() ?? null,
    cityName: coalesceText(firstTextFromSources(sources, "municipio", "cidade", "cidade_nome", "city_name"), address?.municipio),
    cityIbge: normalizeCode(
      coalesceText(
        firstTextFromSources(sources, "codigo_municipio_ibge", "municipio_ibge", "cidade_id", "ibge_id"),
        address?.codigo_municipio_ibge,
        address?.municipio_ibge,
        addressIbge?.codigo_municipio
      ) ?? ""
    ),
    neighborhood: coalesceText(firstTextFromSources(sources, "bairro", "neighborhood"), address?.bairro),
    cep: normalizeCode(coalesceText(firstTextFromSources(sources, "cep"), address?.cep) ?? ""),
    addressLine: resolveAddressLine(item, sources, address),
    addressNumber: coalesceText(firstTextFromSources(sources, "numero", "address_number", "endereco_numero"), address?.numero),
    complement: coalesceText(firstTextFromSources(sources, "complemento", "complement"), address?.complemento),
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

  const rawPayload = await readCasaDosDadosJsonResponse(response);
  const raw = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? rawPayload as Record<string, unknown>
    : { data: rawPayload };

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

async function enrichWithCasaDosDadosDetails(rows: NormalizedEstablishment[]) {
  const normalizedRows = rows.map((row) => ({
    ...row,
    cnpj: normalizeCnpj(row.cnpj)
  })).filter((row) => row.cnpj);

  const enriched = await mapWithConcurrency(normalizedRows, 4, async (current) => {
    try {
      const detail = await fetchCasaDosDadosCompanyByCnpj(current.cnpj);
      return mergeCasaDosDadosEstablishment(current, detail.normalized, detail.raw, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao enriquecer com a Casa dos Dados.";
      return mergeCasaDosDadosEstablishment(current, null, null, message);
    }
  });

  return enriched;
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
    body.porte_empresa = { codigos: companySizes };
  }

  if (input.simplesOnly) {
    body.simples = { optante: true };
  }

  const capitalRange = buildCasaDosDadosCapitalRange(input.capitalSocialMin ?? null, input.capitalSocialMax ?? null);
  if (capitalRange) {
    body.capital_social = capitalRange;
  }

  const openedAtRange = buildCasaDosDadosDateRange(input.activityStartYear ?? null, input.activityStartYearExact === true);
  if (openedAtRange) {
    body.data_abertura = openedAtRange;
  }

  const rawPages: unknown[] = [];
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

    const rawPage = await readCasaDosDadosJsonResponse(response);
    rawPages.push(rawPage);
    pagesFetched += 1;

    if (providerTotalResults === null) {
      providerTotalResults = extractCasaDosDadosTotal(rawPage);
    }

    const pageRows = extractCasaDosDadosRows(rawPage);
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
          const cnpj = extractCasaDosDadosCnpj(item);
          return cnpj ? [cnpj, item] as const : null;
        })
        .filter((item): item is readonly [string, Record<string, unknown>] => Boolean(item))
    ).values()
  );

  const searchNormalized = dedupedRows
    .map((item) => normalizeCasaDosDadosEstablishment(item as Record<string, unknown>))
    .filter(Boolean) as NormalizedEstablishment[];

  const normalized = await enrichWithCasaDosDadosDetails(searchNormalized);

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
