import { CAPITAL_BAND_KEYS, NOT_INFORMED, isOpenedFilterValue } from "@/lib/analytics/dimensions";
import {
  DEFAULT_COMPANY_TABLE_FILTERS,
  type BranchFilter,
  type CompanyTableFilters,
  type ContactFilter,
  type StatusFilter
} from "@/lib/results/company-table-model";

/**
 * Filtros da Lista e do Mapa na URL (mesmos nomes nas duas visões).
 *
 * Trocar de Lista para Mapa/Inteligência preserva o recorte, e um link copiado abre
 * exatamente a mesma visão. Nenhum desses filtros gera nova consulta à Casa dos Dados:
 * eles atuam sobre os resultados já salvos da busca.
 */
export const FILTER_PARAM_KEYS = {
  query: "q",
  status: "situacao",
  contact: "contato",
  state: "uf",
  branch: "unidade",
  municipality: "municipio",
  cnae: "cnae",
  size: "porte",
  capital: "capital",
  opened: "abertura"
} as const satisfies Record<keyof CompanyTableFilters, string>;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

const STATUS_VALUES: StatusFilter[] = ["all", "active", "inactive"];
/** Situação exata (chave de statusKey): "baixada", "inapta", "suspensa", "nula", "na"… */
const STATUS_KEY = /^[a-z][a-z0-9-]{1,39}$/;
const SLUG_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

function statusValue(value: string): StatusFilter {
  const lowered = value.trim().toLowerCase();
  if ((STATUS_VALUES as string[]).includes(lowered)) return lowered as StatusFilter;
  return STATUS_KEY.test(lowered) ? lowered : "all";
}

function dimension(value: string, valid: (value: string) => boolean) {
  const trimmed = value.trim().toLowerCase();
  return trimmed && valid(trimmed) ? trimmed : "all";
}
const CONTACT_VALUES: ContactFilter[] = ["all", "any", "phone", "mobile", "email"];
const BRANCH_VALUES: BranchFilter[] = ["all", "matriz", "filial"];

function read(source: ParamSource, key: string): string {
  if (source instanceof URLSearchParams) return source.get(key) ?? "";
  const value = source[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseCompanyFilters(source: ParamSource): CompanyTableFilters {
  const state = read(source, FILTER_PARAM_KEYS.state).trim().toUpperCase();
  return {
    query: read(source, FILTER_PARAM_KEYS.query).slice(0, 120),
    status: statusValue(read(source, FILTER_PARAM_KEYS.status)),
    contact: oneOf(read(source, FILTER_PARAM_KEYS.contact), CONTACT_VALUES, "all"),
    state: /^[A-Z]{2}$/.test(state) ? state : "all",
    branch: oneOf(read(source, FILTER_PARAM_KEYS.branch), BRANCH_VALUES, "all"),
    municipality: dimension(read(source, FILTER_PARAM_KEYS.municipality), (value) => value === NOT_INFORMED || /^\d{7}$/.test(value)),
    cnae: dimension(read(source, FILTER_PARAM_KEYS.cnae).replace(/[^0-9a-z]/gi, ""), (value) => value === NOT_INFORMED || /^\d{7}$/.test(value)),
    size: dimension(read(source, FILTER_PARAM_KEYS.size), (value) => SLUG_KEY.test(value)),
    capital: dimension(read(source, FILTER_PARAM_KEYS.capital), (value) => value === NOT_INFORMED || CAPITAL_BAND_KEYS.has(value)),
    opened: dimension(read(source, FILTER_PARAM_KEYS.opened), isOpenedFilterValue)
  };
}

/** Escreve só os filtros diferentes do padrão (URLs curtas e estáveis). */
export function writeCompanyFilters(params: URLSearchParams, filters: CompanyTableFilters) {
  for (const key of Object.keys(FILTER_PARAM_KEYS) as Array<keyof CompanyTableFilters>) {
    const paramKey = FILTER_PARAM_KEYS[key];
    const value = key === "query" ? filters.query.trim() : filters[key];
    if (!value || value === DEFAULT_COMPANY_TABLE_FILTERS[key]) params.delete(paramKey);
    else params.set(paramKey, value);
  }
  return params;
}

/** Query string (sem "?") só com os filtros compartilhados, a partir de uma URL qualquer. */
export function pickFilterQuery(search: string) {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();
  for (const key of Object.values(FILTER_PARAM_KEYS)) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  return next.toString();
}

/** Evento disparado quando Lista/Mapa reescrevem os filtros na URL. */
export const URL_PARAMS_EVENT = "buscacnae:url-params";

/** Atualiza a URL atual sem navegar (Next sincroniza useSearchParams com replaceState). */
export function replaceUrlParams(mutate: (params: URLSearchParams) => void) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", next);
    window.dispatchEvent(new Event(URL_PARAMS_EVENT));
  }
}

/** Assinatura para useSyncExternalStore (filtros atuais da URL). */
export function subscribeUrlParams(onChange: () => void) {
  window.addEventListener(URL_PARAMS_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(URL_PARAMS_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}
