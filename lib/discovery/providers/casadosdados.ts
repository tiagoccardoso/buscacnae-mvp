import { getCasaDosDadosKey, getCasaDosDadosTimeoutMs, getDiscoveryMaxResults, getDiscoveryPageSize } from "@/lib/env";
import { DiscoverySearchInput, DiscoverySearchOutput, NormalizedEstablishment } from "@/lib/types";
import {
  coalesceArray,
  coalesceObject,
  coalesceString,
  normalizeCnpj,
  normalizeCode,
  normalizeText,
  parseBoolean,
  parseNumber
} from "@/lib/utils";
import { cleanNormalizedEstablishment } from "@/lib/data-quality";


type CasaDosDadosFieldSource = Record<string, unknown>;

/**
 * Integração única de consulta de empresas do BuscaCNAE (Casa dos Dados).
 *
 * Endpoints oficiais utilizados (https://docs.casadosdados.com.br):
 * - POST /v5/cnpj/pesquisa  -> pesquisa avançada paginada (pagina/limite)
 * - GET  /v4/cnpj/{cnpj}    -> consulta detalhada (contatos, simples/MEI etc.)
 */
const CASA_DOS_DADOS_BASE_URL = "https://api.casadosdados.com.br";
const CASA_DOS_DADOS_SEARCH_PATH = "/v5/cnpj/pesquisa";
const CASA_DOS_DADOS_DETAIL_PATH = "/v4/cnpj";

/** Teto de segurança quando DISCOVERY_MAX_RESULTS não é informado (evita carregar a base inteira). */
export const CASA_DOS_DADOS_DEFAULT_MAX_RESULTS = 1000;
const CASA_DOS_DADOS_MAX_PAGE_SIZE = 1000;
const DETAIL_CONCURRENCY = 4;
const DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const DETAIL_CACHE_MAX_ENTRIES = 5000;
const MAX_RETRY_DELAY_MS = 8000;
const BASE_RETRY_DELAY_MS = 600;

export type CasaDosDadosErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "unavailable"
  | "timeout"
  | "network"
  | "invalid_request"
  | "invalid_response"
  /** Cancelada pelo chamador (AbortSignal): nunca é repetida nem registrada como falha. */
  | "aborted";

export class CasaDosDadosError extends Error {
  readonly kind: CasaDosDadosErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(kind: CasaDosDadosErrorKind, message: string, status: number | null = null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "CasaDosDadosError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isCasaDosDadosError(error: unknown): error is CasaDosDadosError {
  return error instanceof CasaDosDadosError;
}

export function isCasaDosDadosAbort(error: unknown): boolean {
  return error instanceof CasaDosDadosError && error.kind === "aborted";
}

function classifyHttpStatus(status: number): CasaDosDadosErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "unavailable";
  return "invalid_request";
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function abortedError() {
  return new CasaDosDadosError("aborted", "Consulta à Casa dos Dados cancelada.");
}

function throwIfAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) throw abortedError();
}

/** Espera cancelável: um cancelamento durante o backoff encerra a consulta na hora. */
function sleep(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Retry conservador: somente erros transitórios, no máximo 2 novas tentativas.
 * - 429: só tenta novamente se a API informar Retry-After curto; caso contrário falha rápido
 *   (insistir aumentaria o bloqueio).
 * - 502/503/504, erro de rede e timeout: backoff exponencial com jitter.
 */
function computeRetryDelay(error: CasaDosDadosError, attempt: number): number | null {
  if (error.kind === "rate_limit") {
    if (attempt >= 1 || error.retryAfterMs === null || error.retryAfterMs > MAX_RETRY_DELAY_MS) return null;
    return Math.max(250, error.retryAfterMs);
  }

  const transientStatus = error.status === 502 || error.status === 503 || error.status === 504;
  const retryable = error.kind === "network" || (error.kind === "unavailable" && transientStatus) || error.kind === "timeout";
  const maxAttempts = error.kind === "timeout" ? 1 : 2;
  if (!retryable || attempt >= maxAttempts) return null;

  const backoff = BASE_RETRY_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 250);
  const hinted = error.retryAfterMs ?? 0;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(backoff, hinted));
}

function logCasaDosDadosFailure(context: string, error: CasaDosDadosError, attempt: number, willRetry: boolean) {
  // Somente metadados de diagnóstico: nunca a chave, headers ou corpo da resposta.
  console.warn("[casadosdados]", {
    context,
    kind: error.kind,
    status: error.status,
    attempt: attempt + 1,
    willRetry
  });
}

async function readCasaDosDadosJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new CasaDosDadosError("invalid_response", "Casa dos Dados retornou uma resposta vazia.", response.status);
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("unexpected");
    }
    return parsed;
  } catch {
    throw new CasaDosDadosError("invalid_response", "Casa dos Dados retornou uma resposta em formato inválido.", response.status);
  }
}

async function performCasaDosDadosRequest(
  path: string,
  method: "GET" | "POST",
  body: unknown,
  apiKey: string,
  signal?: AbortSignal | null
) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getCasaDosDadosTimeoutMs());
  // Cancelamento externo (ex.: usuário saiu da página) aborta a requisição em andamento.
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(`${CASA_DOS_DADOS_BASE_URL}${path}`, {
      method,
      headers: {
        "api-key": apiKey,
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {})
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (signal?.aborted) throw abortedError();
    const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    throw aborted
      ? new CasaDosDadosError("timeout", "Casa dos Dados não respondeu dentro do tempo limite.")
      : new CasaDosDadosError("network", "Falha de conexão com a Casa dos Dados.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }

  if (!response.ok) {
    // Descarta o corpo sem propagá-lo (pode conter dados sensíveis/ruído técnico).
    await response.text().catch(() => "");
    throw new CasaDosDadosError(
      classifyHttpStatus(response.status),
      `Casa dos Dados respondeu ${response.status}.`,
      response.status,
      parseRetryAfterMs(response.headers.get("retry-after"))
    );
  }

  return readCasaDosDadosJsonResponse(response);
}

async function requestCasaDosDados(
  path: string,
  method: "GET" | "POST",
  body: unknown,
  context: string,
  signal?: AbortSignal | null
): Promise<unknown> {
  let apiKey: string;
  try {
    apiKey = getCasaDosDadosKey();
  } catch {
    const error = new CasaDosDadosError("config", "Chave da Casa dos Dados não configurada.");
    logCasaDosDadosFailure(context, error, 0, false);
    throw error;
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await performCasaDosDadosRequest(path, method, body, apiKey, signal);
    } catch (error) {
      const normalized = isCasaDosDadosError(error)
        ? error
        : new CasaDosDadosError("network", "Falha inesperada ao consultar a Casa dos Dados.");
      if (normalized.kind === "aborted") throw normalized;
      const delay = computeRetryDelay(normalized, attempt);
      logCasaDosDadosFailure(context, normalized, attempt, delay !== null);
      if (delay === null) throw normalized;
      await sleep(delay, signal);
    }
  }
}

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
    if (/^0[135]$/.test(value.trim())) return value.trim();
    return null;
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

/** Chave com o instante (ISO) em que a consulta detalhada foi obtida na Casa dos Dados. */
export const CASA_DOS_DADOS_DETAIL_FETCHED_AT_KEY = "casadosdados_detalhe_em";

function mergeProviderPayload(searchPayload: unknown, detailPayload?: unknown, detailFetchedAt?: string | null) {
  return {
    casadosdados_pesquisa: searchPayload ?? null,
    casadosdados_detalhe: detailPayload ?? null,
    ...(detailPayload && detailFetchedAt ? { [CASA_DOS_DADOS_DETAIL_FETCHED_AT_KEY]: detailFetchedAt } : {})
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

const MISSING_COMPANY_NAME = "Sem razão social";

function realCompanyName(value: string | null | undefined) {
  return value && value !== MISSING_COMPANY_NAME ? value : null;
}

function mergeCasaDosDadosEstablishment(
  searchRow: NormalizedEstablishment,
  detailRow?: NormalizedEstablishment | null,
  detailRaw?: unknown,
  detailFetchedAt?: string | null
): NormalizedEstablishment {
  if (!detailRow) {
    return {
      ...searchRow,
      providerPayload: mergeProviderPayload(searchRow.providerPayload, detailRaw, detailFetchedAt)
    };
  }

  return {
    cnpj: detailRow.cnpj || searchRow.cnpj,
    cnpjRoot: pickFirstNonEmpty(detailRow.cnpjRoot, searchRow.cnpjRoot),
    // "Sem razão social" é só o marcador de ausência: não pode sobrepor o nome real da outra fonte.
    companyName:
      pickFirstNonEmpty(realCompanyName(detailRow.companyName), realCompanyName(searchRow.companyName)) ?? MISSING_COMPANY_NAME,
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
    providerPayload: mergeProviderPayload(searchRow.providerPayload, detailRaw, detailFetchedAt)
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

  // Toda linha passa pela etapa central de qualidade de dados (lib/data-quality).
  return cleanNormalizedEstablishment({
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
  });
}

export type CasaDosDadosDetail = {
  raw: Record<string, unknown>;
  normalized: NormalizedEstablishment | null;
  /** Instante (ISO) em que a Casa dos Dados respondeu a consulta detalhada. */
  fetchedAt?: string;
};

/** Consulta detalhada já persistida (establishments.provider_payload) e ainda dentro da janela de reuso. */
export type StoredCasaDosDadosDetail = {
  raw: Record<string, unknown>;
  fetchedAt: string;
};

/**
 * Busca, em lote, consultas detalhadas já salvas. Implementada fora do provider
 * (lib/discovery/detail-store.ts) para manter este módulo sem dependência de banco.
 */
export type StoredDetailLookup = (cnpjs: string[]) => Promise<Map<string, StoredCasaDosDadosDetail>>;

export type CasaDosDadosSearchOptions = {
  storedDetails?: StoredDetailLookup;
  /**
   * Cancelamento cooperativo: interrompe paginação, backoff e novas consultas detalhadas.
   * Consultas detalhadas já em andamento são compartilhadas (dedupe) e não são abortadas,
   * pois podem estar servindo outra busca simultânea; seu resultado vai para o cache.
   */
  signal?: AbortSignal | null;
};

// Cache em memória (por instância) + deduplicação de consultas detalhadas simultâneas.
const detailCache = new Map<string, { expiresAt: number; value: CasaDosDadosDetail }>();
const detailInFlight = new Map<string, Promise<CasaDosDadosDetail>>();

function readDetailCache(cnpj: string) {
  const entry = detailCache.get(cnpj);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    detailCache.delete(cnpj);
    return null;
  }
  return entry.value;
}

function writeDetailCache(cnpj: string, value: CasaDosDadosDetail) {
  if (detailCache.size >= DETAIL_CACHE_MAX_ENTRIES) {
    const oldestKey = detailCache.keys().next().value;
    if (oldestKey !== undefined) detailCache.delete(oldestKey);
  }
  detailCache.set(cnpj, { expiresAt: Date.now() + DETAIL_CACHE_TTL_MS, value });
}

async function loadCasaDosDadosCompanyByCnpj(normalizedCnpj: string): Promise<CasaDosDadosDetail> {
  const rawPayload = await requestCasaDosDados(`${CASA_DOS_DADOS_DETAIL_PATH}/${normalizedCnpj}`, "GET", undefined, "detalhe");
  const raw = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? rawPayload as Record<string, unknown>
    : { data: rawPayload };

  return buildCasaDosDadosDetail(raw, new Date().toISOString());
}

/** Normaliza uma resposta do GET /v4/cnpj (nova ou reaproveitada do banco). */
export function buildCasaDosDadosDetail(raw: Record<string, unknown>, fetchedAt: string): CasaDosDadosDetail {
  const normalized = normalizeCasaDosDadosEstablishment(raw);

  return {
    raw,
    fetchedAt,
    // Município já chega em title case pt-BR pela etapa de qualidade de dados.
    normalized
  };
}

export async function fetchCasaDosDadosCompanyByCnpj(cnpj: string): Promise<CasaDosDadosDetail> {
  const normalizedCnpj = normalizeCnpj(cnpj);
  if (normalizedCnpj.length !== 14) {
    throw new CasaDosDadosError("invalid_request", "CNPJ inválido para consulta detalhada.");
  }

  const cached = readDetailCache(normalizedCnpj);
  if (cached) return cached;

  const pending = detailInFlight.get(normalizedCnpj);
  if (pending) return pending;

  const request = loadCasaDosDadosCompanyByCnpj(normalizedCnpj)
    .then((value) => {
      writeDetailCache(normalizedCnpj, value);
      return value;
    })
    .finally(() => {
      detailInFlight.delete(normalizedCnpj);
    });

  detailInFlight.set(normalizedCnpj, request);
  return request;
}

type DetailEnrichmentSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Linhas atendidas por consulta detalhada já salva (nenhuma chamada HTTP). */
  reused: number;
};

async function loadStoredDetailsSafely(rows: NormalizedEstablishment[], lookup?: StoredDetailLookup) {
  if (!lookup || rows.length === 0) return new Map<string, StoredCasaDosDadosDetail>();
  try {
    return await lookup(rows.map((row) => row.cnpj));
  } catch (error) {
    // Reuso é otimização: se o banco falhar, segue consultando a Casa dos Dados normalmente.
    console.warn("[casadosdados] reuso de consulta detalhada indisponível", {
      name: error instanceof Error ? error.name : "unknown"
    });
    return new Map<string, StoredCasaDosDadosDetail>();
  }
}

/**
 * A pesquisa avançada não devolve contatos (e-mail/telefone) nem Simples/MEI;
 * esses campos vêm da consulta detalhada por CNPJ da própria Casa dos Dados.
 * Falhas aqui não invalidam a busca: a linha segue com os dados da pesquisa.
 * Em erro de autenticação/configuração/rate limit o enriquecimento é interrompido
 * (circuit breaker) para não agravar o bloqueio nem gastar créditos inutilmente.
 */
export async function enrichWithCasaDosDadosDetails(rows: NormalizedEstablishment[], options: CasaDosDadosSearchOptions = {}) {
  const summary: DetailEnrichmentSummary = { attempted: 0, succeeded: 0, failed: 0, skipped: 0, reused: 0 };
  let halted = false;
  const stored = await loadStoredDetailsSafely(rows, options.storedDetails);

  const enriched = await mapWithConcurrency(rows, DETAIL_CONCURRENCY, async (current) => {
    const reusable = stored.get(current.cnpj);
    if (reusable) {
      const detail = buildCasaDosDadosDetail(reusable.raw, reusable.fetchedAt);
      if (detail.normalized) {
        summary.reused += 1;
        return mergeCasaDosDadosEstablishment(current, detail.normalized, detail.raw, detail.fetchedAt);
      }
    }

    if (halted || options.signal?.aborted) {
      summary.skipped += 1;
      return mergeCasaDosDadosEstablishment(current, null, null);
    }

    summary.attempted += 1;
    try {
      const detail = await fetchCasaDosDadosCompanyByCnpj(current.cnpj);
      summary.succeeded += 1;
      return mergeCasaDosDadosEstablishment(current, detail.normalized, detail.raw, detail.fetchedAt ?? null);
    } catch (error) {
      summary.failed += 1;
      if (isCasaDosDadosError(error) && (error.kind === "rate_limit" || error.kind === "auth" || error.kind === "config")) {
        halted = true;
      }
      return mergeCasaDosDadosEstablishment(current, null, null);
    }
  });

  throwIfAborted(options.signal);
  if (summary.failed > 0 || summary.skipped > 0) {
    console.warn("[casadosdados] consulta detalhada incompleta", summary);
  }
  if (summary.reused > 0) {
    console.info("[casadosdados] consultas detalhadas reaproveitadas do banco", { reused: summary.reused, requested: summary.attempted });
  }

  return { rows: enriched, summary };
}

function mapCasaDosDadosCompanySizeCodes(values: string[] | undefined) {
  return mapCasaDosDadosCompanySizes(values).filter((code) => code === "01" || code === "03" || code === "05");
}

/**
 * Monta o corpo da pesquisa avançada (POST /v5/cnpj/pesquisa) somente com filtros
 * suportados pela API e já normalizados. Campos vazios não são enviados.
 */
export function buildCasaDosDadosSearchBody(input: DiscoverySearchInput): Record<string, unknown> {
  const cnae = normalizeCode(input.cnae ?? "");
  if (!/^\d{7}$/.test(cnae)) {
    throw new CasaDosDadosError("invalid_request", "CNAE inválido para a pesquisa.");
  }

  const body: Record<string, unknown> = {
    codigo_atividade_principal: [cnae],
    incluir_atividade_secundaria: false,
    situacao_cadastral: ["ATIVA"]
  };

  // A API espera UF e município em minúsculas e sem acentos (ex.: "sp", "sao paulo").
  const stateCode = (input.stateCode ?? "").trim().toLowerCase();
  if (/^[a-z]{2}$/.test(stateCode)) {
    body.uf = [stateCode];
  }

  const cityName = normalizeText(input.cityName ?? "");
  if (cityName) {
    body.municipio = [cityName];
  }

  const moreFilters: Record<string, boolean> = {};
  if (input.requireEmail) moreFilters.com_email = true;
  if (input.requirePhone || input.mobileOnly) moreFilters.com_telefone = true;
  if (input.mobileOnly) moreFilters.somente_celular = true;
  if (Object.keys(moreFilters).length > 0) {
    body.mais_filtros = moreFilters;
  }

  const companySizes = mapCasaDosDadosCompanySizeCodes(input.companySizes);
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

  return body;
}

export function resolveCasaDosDadosPaging() {
  const configuredPageSize = Math.trunc(getDiscoveryPageSize() || 0);
  const configuredMax = Math.trunc(getDiscoveryMaxResults() || 0);
  const maxResults = configuredMax > 0 ? configuredMax : CASA_DOS_DADOS_DEFAULT_MAX_RESULTS;
  const pageSize = Math.min(
    Math.max(1, configuredPageSize > 0 ? configuredPageSize : 50),
    CASA_DOS_DADOS_MAX_PAGE_SIZE,
    maxResults
  );
  return { pageSize, maxResults, maxPages: Math.max(1, Math.ceil(maxResults / pageSize)) };
}

export async function searchWithCasaDosDados(
  input: DiscoverySearchInput,
  options: CasaDosDadosSearchOptions = {}
): Promise<DiscoverySearchOutput> {
  const body = buildCasaDosDadosSearchBody(input);
  const { pageSize, maxResults, maxPages } = resolveCasaDosDadosPaging();

  const rawPages: unknown[] = [];
  const rowsByCnpj = new Map<string, Record<string, unknown>>();
  let providerTotalResults: number | null = null;
  let pagesFetched = 0;
  let hitFetchLimit = false;

  // Paginação oficial (pagina/limite) com tamanho de página fixo para não pular nem repetir registros.
  for (let page = 1; page <= maxPages; page += 1) {
    throwIfAborted(options.signal);
    const rawPage = await requestCasaDosDados(
      CASA_DOS_DADOS_SEARCH_PATH,
      "POST",
      { ...body, pagina: page, limite: pageSize },
      "pesquisa",
      options.signal
    );
    rawPages.push(rawPage);
    pagesFetched += 1;

    if (providerTotalResults === null) {
      providerTotalResults = extractCasaDosDadosTotal(rawPage);
    }

    const pageRows = extractCasaDosDadosRows(rawPage);
    let newRows = 0;
    for (const item of pageRows) {
      const cnpj = extractCasaDosDadosCnpj(item);
      if (!cnpj || rowsByCnpj.has(cnpj)) continue;
      rowsByCnpj.set(cnpj, item);
      newRows += 1;
    }

    if (rowsByCnpj.size >= maxResults) {
      hitFetchLimit = providerTotalResults === null || providerTotalResults > maxResults;
      break;
    }

    // Com total conhecido, ele define o fim; sem total, uma página incompleta indica a última.
    const reachedEnd =
      pageRows.length === 0 ||
      newRows === 0 ||
      (providerTotalResults !== null ? rowsByCnpj.size >= providerTotalResults : pageRows.length < pageSize);
    if (reachedEnd) break;

    if (page === maxPages) {
      hitFetchLimit = true;
    }
  }

  const searchNormalized = Array.from(rowsByCnpj.values())
    .slice(0, maxResults)
    .map((item) => normalizeCasaDosDadosEstablishment(item))
    .filter((item): item is NormalizedEstablishment => Boolean(item));

  const enrichment = await enrichWithCasaDosDadosDetails(searchNormalized, options);

  return {
    provider: "casadosdados",
    raw: rawPages.length === 1 ? rawPages[0] : { paginas: rawPages },
    normalized: enrichment.rows,
    providerTotalResults,
    fetchedResults: enrichment.rows.length,
    pagesFetched,
    hitFetchLimit,
    detailIncomplete: enrichment.summary.failed > 0 || enrichment.summary.skipped > 0,
    detailRequests: enrichment.summary.attempted,
    detailReused: enrichment.summary.reused
  };
}
