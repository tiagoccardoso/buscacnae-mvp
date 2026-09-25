import {
  CAPITAL_BAND_KEYS,
  NOT_INFORMED,
  capitalBandLabel,
  formatCnaeCode,
  isOpenedFilterValue,
  matchesOpenedKeys,
  openedFilterLabel
} from "@/lib/analytics/dimensions";
import { keysOf, type AnalyticsRecord } from "@/lib/analytics/metrics";
import {
  DEFAULT_COMPANY_TABLE_FILTERS,
  matchesBaseFilters,
  type CompanyTableFilters
} from "@/lib/results/company-table-model";
import type { AiFilterSpec } from "@/lib/ai/types";

/**
 * Filtros da IA: validação (entrada NÃO confiável — vem do navegador ou do modelo),
 * aplicação determinística sobre os registros analíticos e conversão de/para os filtros
 * da URL usados por Lista, Mapa e Inteligência.
 *
 * Nada aqui gera SQL: o filtro é avaliado em memória sobre o universo já autorizado da
 * busca (mesmas chaves de lib/analytics/dimensions.ts), então um valor malicioso no
 * máximo não encontra nenhuma empresa.
 */

export const MAX_VALUES_PER_DIMENSION = 12;
export const MAX_QUERY_LENGTH = 80;

const STATUS_KEY = /^[a-z][a-z0-9-]{1,39}$/;
const SLUG_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const IBGE = /^\d{7}$/;
const UF = /^[A-Z]{2}$/;
const CNAE = /^\d{7}$/;

function uniqueValid(values: unknown, normalize: (value: string) => string, valid: (value: string) => boolean) {
  if (!Array.isArray(values)) return undefined;
  const out: string[] = [];
  for (const raw of values.slice(0, MAX_VALUES_PER_DIMENSION * 2)) {
    if (typeof raw !== "string") continue;
    const value = normalize(raw);
    if (valid(value) && !out.includes(value)) out.push(value);
    if (out.length >= MAX_VALUES_PER_DIMENSION) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Remove caracteres de controle e limita o tamanho (texto vai só para comparação em memória). */
export function sanitizeText(value: unknown, max = MAX_QUERY_LENGTH) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Valida um filtro vindo de fora (eco do navegador ou saída do modelo). Tudo que não
 * obedece ao formato é DESCARTADO (nunca "corrigido" por aproximação).
 */
export function sanitizeFilterSpec(input: unknown): AiFilterSpec {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const spec: AiFilterSpec = {};

  const query = sanitizeText(source.query);
  if (query) spec.query = query;

  if (typeof source.status === "string") {
    const status = source.status.trim().toLowerCase();
    if (STATUS_KEY.test(status)) spec.status = status;
  }
  if (source.contact === "any" || source.contact === "phone" || source.contact === "mobile" || source.contact === "email") spec.contact = source.contact;
  if (source.branch === "matriz" || source.branch === "filial") spec.branch = source.branch;

  const states = uniqueValid(source.states, (value) => value.trim().toUpperCase(), (value) => UF.test(value));
  if (states) spec.states = states;
  const municipalities = uniqueValid(source.municipalities, (value) => value.trim().toLowerCase(), (value) => value === NOT_INFORMED || IBGE.test(value));
  if (municipalities) spec.municipalities = municipalities;
  const cnaes = uniqueValid(
    source.cnaes,
    (value) => (value.trim().toLowerCase() === NOT_INFORMED ? NOT_INFORMED : value.replace(/\D/g, "")),
    (value) => value === NOT_INFORMED || CNAE.test(value)
  );
  if (cnaes) spec.cnaes = cnaes;
  const sizes = uniqueValid(source.sizes, (value) => value.trim().toLowerCase(), (value) => SLUG_KEY.test(value));
  if (sizes) spec.sizes = sizes;
  const capital = uniqueValid(source.capital, (value) => value.trim().toLowerCase(), (value) => value === NOT_INFORMED || CAPITAL_BAND_KEYS.has(value));
  if (capital) spec.capital = capital;

  if (typeof source.opened === "string") {
    const opened = source.opened.trim().toLowerCase();
    if (isOpenedFilterValue(opened)) spec.opened = opened;
  }
  return spec;
}

/* ------------------------------------------------------------------ aplicação */

function matchesStatusKey(statusKey: string, filter: string) {
  if (filter === "active") return statusKey === "ativa";
  if (filter === "inactive") return statusKey !== "ativa";
  return statusKey === filter;
}

/** Mesma regra dos filtros da Lista/Mapa/Inteligência, com vários valores por dimensão. */
export function recordMatchesSpec(record: AnalyticsRecord, spec: AiFilterSpec, referenceDate: string) {
  const keys = keysOf(record);
  if (spec.status && !matchesStatusKey(keys.status, spec.status)) return false;
  if (spec.states && !spec.states.includes(keys.state)) return false;
  if (spec.municipalities && !spec.municipalities.includes(keys.municipality)) return false;
  if (spec.cnaes && !spec.cnaes.includes(keys.cnae)) return false;
  if (spec.sizes && !spec.sizes.includes(keys.size)) return false;
  if (spec.capital && !spec.capital.includes(keys.capital)) return false;
  if (spec.opened && !matchesOpenedKeys(keys, spec.opened, referenceDate)) return false;
  if (spec.query || spec.contact || spec.branch) {
    return matchesBaseFilters(record, {
      ...DEFAULT_COMPANY_TABLE_FILTERS,
      query: spec.query ?? "",
      contact: spec.contact ?? "all",
      branch: spec.branch ?? "all"
    });
  }
  return true;
}

export function filterRecords(records: readonly AnalyticsRecord[], spec: AiFilterSpec, referenceDate: string) {
  const out: AnalyticsRecord[] = [];
  for (const record of records) if (recordMatchesSpec(record, spec, referenceDate)) out.push(record);
  return out;
}

/* ------------------------------------------------------------------ URL ⇄ spec */

export function specFromTableFilters(filters: CompanyTableFilters): AiFilterSpec {
  const spec: AiFilterSpec = {};
  if (filters.query.trim()) spec.query = filters.query.trim().slice(0, MAX_QUERY_LENGTH);
  if (filters.status !== "all") spec.status = filters.status;
  if (filters.contact !== "all") spec.contact = filters.contact;
  if (filters.branch !== "all") spec.branch = filters.branch;
  if (filters.state !== "all") spec.states = [filters.state];
  if (filters.municipality !== "all") spec.municipalities = [filters.municipality];
  if (filters.cnae !== "all") spec.cnaes = [filters.cnae];
  if (filters.size !== "all") spec.sizes = [filters.size];
  if (filters.capital !== "all") spec.capital = [filters.capital];
  if (filters.opened !== "all") spec.opened = filters.opened;
  return spec;
}

export type TableFiltersConversion =
  | { representable: true; filters: CompanyTableFilters }
  | { representable: false; filters: null; multi: Array<keyof AiFilterSpec> };

/** Spec → filtros da URL. Só é possível com no máximo um valor por dimensão. */
export function toTableFilters(spec: AiFilterSpec): TableFiltersConversion {
  const multi = (["states", "municipalities", "cnaes", "sizes", "capital"] as const).filter((key) => (spec[key]?.length ?? 0) > 1);
  if (multi.length > 0) return { representable: false, filters: null, multi: [...multi] };
  return {
    representable: true,
    filters: {
      ...DEFAULT_COMPANY_TABLE_FILTERS,
      query: spec.query ?? "",
      status: spec.status ?? "all",
      contact: spec.contact ?? "all",
      branch: spec.branch ?? "all",
      state: spec.states?.[0] ?? "all",
      municipality: spec.municipalities?.[0] ?? "all",
      cnae: spec.cnaes?.[0] ?? "all",
      size: spec.sizes?.[0] ?? "all",
      capital: spec.capital?.[0] ?? "all",
      opened: spec.opened ?? "all"
    }
  };
}

/** Sobrepõe `next` a `base` por dimensão (dimensão mencionada substitui a herdada). */
export function mergeSpecs(base: AiFilterSpec, next: AiFilterSpec): AiFilterSpec {
  const merged: AiFilterSpec = { ...base };
  for (const [key, value] of Object.entries(next) as Array<[keyof AiFilterSpec, AiFilterSpec[keyof AiFilterSpec]]>) {
    if (value === undefined) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

export function isEmptySpec(spec: AiFilterSpec) {
  return Object.values(spec).every((value) => value === undefined || (Array.isArray(value) && value.length === 0) || value === "");
}

/* ------------------------------------------------------------------ rótulos */

export type SpecLabelLookup = {
  municipality: Map<string, string>;
  cnae: Map<string, string>;
  size: Map<string, string>;
  status: Map<string, string>;
};

const CONTACT_LABELS = { any: "Com telefone ou e-mail", phone: "Com telefone", mobile: "Com celular", email: "Com e-mail" } as const;

function list(values: string[], label: (value: string) => string) {
  const labels = values.map(label);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} ou ${labels[labels.length - 1]}`;
}

/** Rótulos legíveis ("Município: Cascavel/PR", "Porte: ME"…), na ordem dos chips da interface. */
export function describeSpec(spec: AiFilterSpec, lookup: SpecLabelLookup): string[] {
  const out: string[] = [];
  if (spec.cnaes) out.push(`CNAE: ${list(spec.cnaes, (key) => (key === NOT_INFORMED ? "não informado" : lookup.cnae.get(key) ?? formatCnaeCode(key)))}`);
  if (spec.states) out.push(`UF: ${list(spec.states, (key) => key)}`);
  if (spec.municipalities)
    out.push(`Município: ${list(spec.municipalities, (key) => (key === NOT_INFORMED ? "não identificado" : lookup.municipality.get(key) ?? key))}`);
  if (spec.status)
    out.push(
      `Situação: ${spec.status === "active" ? "Ativas" : spec.status === "inactive" ? "Outras situações" : lookup.status.get(spec.status) ?? spec.status}`
    );
  if (spec.sizes) out.push(`Porte: ${list(spec.sizes, (key) => (key === NOT_INFORMED ? "não informado" : lookup.size.get(key) ?? key.toUpperCase()))}`);
  if (spec.capital) out.push(`Capital: ${list(spec.capital, capitalBandLabel)}`);
  if (spec.opened) out.push(openedFilterLabel(spec.opened));
  if (spec.contact) out.push(CONTACT_LABELS[spec.contact]);
  if (spec.branch) out.push(spec.branch === "matriz" ? "Somente matrizes" : "Somente filiais");
  if (spec.query) out.push(`Busca: “${spec.query}”`);
  return out;
}
