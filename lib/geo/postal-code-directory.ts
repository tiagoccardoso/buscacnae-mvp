import { getPostalDirectoryConfig } from "@/lib/env";
import { normalizeCep } from "@/lib/geo/company-location";

/**
 * Diretório de CEP como COMPLEMENTO territorial (preparação da Fase 2).
 *
 * Avaliação do OpenCEP (https://github.com/SeuAliado/OpenCEP):
 * - base aberta dos Correios servida por CDN: `GET https://opencep.com/v1/{cep}` devolve
 *   logradouro, bairro, localidade, UF e código IBGE; NÃO devolve coordenadas;
 * - também pode ser auto-hospedada (releases com os JSON), sem dependência externa.
 *
 * Regras desta camada:
 * - a Casa dos Dados continua sendo a fonte do endereço da empresa;
 * - o diretório só PREENCHE campos ausentes (ex.: IBGE do município, bairro) e aponta
 *   divergências — nunca substitui um valor válido da Casa dos Dados;
 * - consultas por CEP único (nunca por empresa), limitadas por requisição, com timeout,
 *   orçamento de tempo, circuit breaker e cache em memória;
 * - desligado por padrão (LOCATION_POSTAL_DIRECTORY=none). Nenhum fluxo da Fase 1 o chama:
 *   pesquisa, ficha e exportação não disparam requisições para ele.
 */
export type PostalCodeAddress = {
  cep: string;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  cityIbge: string | null;
  source: string;
};

export type PostalCodeDirectory = {
  id: string;
  lookup(cep: string, signal: AbortSignal): Promise<PostalCodeAddress | null>;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Aceita o formato do OpenCEP (e o equivalente ViaCEP): cep, logradouro, bairro, localidade, uf, ibge. */
export function parsePostalCodeAddress(body: unknown, source: string): PostalCodeAddress | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.erro === true || record.error) return null;
  const cep = normalizeCep(text(record.cep));
  if (!cep) return null;
  const ibge = text(record.ibge)?.replace(/\D/g, "") ?? null;
  const state = text(record.uf)?.toUpperCase() ?? null;
  return {
    cep,
    street: text(record.logradouro),
    neighborhood: text(record.bairro),
    city: text(record.localidade),
    state: state && /^[A-Z]{2}$/.test(state) ? state : null,
    cityIbge: ibge && ibge.length === 7 ? ibge : null,
    source
  };
}

export const openCepDirectory: PostalCodeDirectory = {
  id: "opencep",
  async lookup(cep, signal) {
    const response = await fetch(`https://opencep.com/v1/${cep}`, {
      headers: { Accept: "application/json" },
      signal,
      // CEP muda raramente: deixa o cache HTTP do Next reaproveitar por 30 dias.
      next: { revalidate: 60 * 60 * 24 * 30 }
    } as RequestInit);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`postal_directory_http_${response.status}`);
    return parsePostalCodeAddress(await response.json(), "opencep");
  }
};

export function resolvePostalCodeDirectory(providerId: string): PostalCodeDirectory | null {
  return providerId === "opencep" ? openCepDirectory : null;
}

type CacheEntry = { value: PostalCodeAddress | null; expiresAt: number };
const MEMORY_TTL_MS = 12 * 60 * 60 * 1000;
const MEMORY_MAX_ENTRIES = 20_000;
const memory = new Map<string, CacheEntry>();

function remember(cep: string, value: PostalCodeAddress | null) {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(cep, { value, expiresAt: Date.now() + MEMORY_TTL_MS });
}

export type PostalAddressResolution = {
  addresses: Map<string, PostalCodeAddress>;
  /** CEPs que ficaram sem consulta (limite/orçamento) e podem ser resolvidos depois. */
  pending: number;
  enabled: boolean;
};

export async function resolvePostalAddresses(
  ceps: string[],
  options: { directory?: PostalCodeDirectory | null; maxLookups?: number; concurrency?: number; timeoutMs?: number; budgetMs?: number } = {}
): Promise<PostalAddressResolution> {
  const config = getPostalDirectoryConfig();
  const directory = options.directory === undefined ? resolvePostalCodeDirectory(config.provider) : options.directory;
  const maxLookups = Math.max(0, options.maxLookups ?? config.maxLookups);
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const timeoutMs = options.timeoutMs ?? 3000;
  const deadline = Date.now() + (options.budgetMs ?? 5000);

  const unique = Array.from(new Set(ceps.map((cep) => normalizeCep(cep)).filter((cep): cep is string => Boolean(cep))));
  const addresses = new Map<string, PostalCodeAddress>();
  const toLookup: string[] = [];

  for (const cep of unique) {
    const cached = memory.get(cep);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.value) addresses.set(cep, cached.value);
    } else {
      toLookup.push(cep);
    }
  }

  if (!directory || maxLookups === 0 || toLookup.length === 0) {
    return { addresses, pending: toLookup.length, enabled: Boolean(directory) };
  }

  const batch = toLookup.slice(0, maxLookups);
  const resolved = new Set<string>();
  let cursor = 0;
  let halted = false;

  async function worker() {
    while (cursor < batch.length && !halted && Date.now() < deadline) {
      const cep = batch[cursor];
      cursor += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, Math.max(250, deadline - Date.now())));
      try {
        const value = await directory!.lookup(cep, controller.signal);
        remember(cep, value);
        resolved.add(cep);
        if (value) addresses.set(cep, value);
      } catch (error) {
        if (error instanceof Error && /postal_directory_http_(429|5\d\d)/.test(error.message)) halted = true;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, () => worker()));
  return { addresses, pending: toLookup.filter((cep) => !resolved.has(cep)).length, enabled: true };
}

export type TerritorialAddress = {
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  cityIbge: string | null;
  postalCode: string | null;
};

export type TerritorialComplement<T extends TerritorialAddress> = {
  address: T;
  /** Campos preenchidos pelo diretório (antes ausentes na Casa dos Dados). */
  filled: Array<keyof TerritorialAddress>;
  /** Campos em que o diretório diverge do valor da Casa dos Dados (mantido). */
  conflicts: Array<keyof TerritorialAddress>;
};

function fold(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Complementa o endereço da Casa dos Dados com o diretório de CEP.
 * Nunca sobrescreve valor existente; se cidade/UF divergirem, NÃO complementa nada
 * (CEP possivelmente desatualizado) e registra o conflito.
 */
export function complementAddressWithPostalDirectory<T extends TerritorialAddress>(
  address: T,
  directory: PostalCodeAddress | null | undefined
): TerritorialComplement<T> {
  if (!directory || normalizeCep(address.postalCode) !== directory.cep) {
    return { address, filled: [], conflicts: [] };
  }

  const conflicts: Array<keyof TerritorialAddress> = [];
  if (address.state && directory.state && fold(address.state) !== fold(directory.state)) conflicts.push("state");
  if (address.city && directory.city && fold(address.city) !== fold(directory.city)) conflicts.push("city");
  if (address.cityIbge && directory.cityIbge && address.cityIbge !== directory.cityIbge) conflicts.push("cityIbge");
  if (conflicts.length > 0) return { address, filled: [], conflicts };

  const next = { ...address };
  const filled: Array<keyof TerritorialAddress> = [];
  const fill = (key: keyof TerritorialAddress, value: string | null) => {
    if (!next[key] && value) {
      (next as TerritorialAddress)[key] = value;
      filled.push(key);
    }
  };
  fill("cityIbge", directory.cityIbge);
  fill("city", directory.city);
  fill("state", directory.state);
  fill("neighborhood", directory.neighborhood);
  fill("street", directory.street);
  return { address: next, filled, conflicts };
}

/** Apenas para testes. */
export function __resetPostalDirectoryCache() {
  memory.clear();
}
