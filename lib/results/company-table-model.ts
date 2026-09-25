import type { CompanyListItem } from "@/lib/company-model";
import {
  NOT_INFORMED,
  analysisReferenceDate,
  capitalBandKey,
  cnaeKey,
  foldText,
  isActiveStatus,
  matchesOpenedFilter,
  matchesOpenedKeys,
  type FacetKeys,
  municipalityDimensionKey,
  sizeKey,
  statusKey
} from "@/lib/analytics/dimensions";

export { foldText, isActiveStatus };

/**
 * Regras puras da tabela de resultados (sem React), compartilhadas pelo componente
 * client e pelos testes. Filtros atuam sobre o modelo normalizado (CompanyListItem).
 *
 * Fase 3: os mesmos filtros valem para Lista, Mapa e Inteligência. Além dos filtros
 * da tabela (busca, situação, contato, UF, matriz/filial) existem os filtros de
 * DIMENSÃO usados pelo drill-down dos gráficos (município, CNAE, porte, faixa de
 * capital, abertura). As chaves vêm de lib/analytics/dimensions.ts.
 */

/** "all" | "active" | "inactive" | situação exata (chave: "baixada", "inapta", "na"…). */
export type StatusFilter = "all" | "active" | "inactive" | (string & {});
export type ContactFilter = "all" | "any" | "phone" | "mobile" | "email";
export type BranchFilter = "all" | "matriz" | "filial";

export type CompanyTableFilters = {
  query: string;
  status: StatusFilter;
  contact: ContactFilter;
  state: string;
  branch: BranchFilter;
  /** Código IBGE do município ("all" | 7 dígitos | "na"). */
  municipality: string;
  /** CNAE principal ("all" | 7 dígitos | "na"). */
  cnae: string;
  /** Porte (chave de sizeKey: "me", "epp", "demais"… | "na"). */
  size: string;
  /** Faixa de capital social (CAPITAL_BANDS[].key | "na"). */
  capital: string;
  /** Abertura: "12m" | "AAAA" | "AAAA-MM" | "na". */
  opened: string;
};

export const DEFAULT_COMPANY_TABLE_FILTERS: CompanyTableFilters = {
  query: "",
  status: "all",
  contact: "all",
  state: "all",
  branch: "all",
  municipality: "all",
  cnae: "all",
  size: "all",
  capital: "all",
  opened: "all"
};

/** Filtros de dimensão (drill-down), na ordem em que aparecem como "chips". */
export const DIMENSION_FILTER_KEYS = ["municipality", "cnae", "size", "capital", "opened"] as const;
export type DimensionFilterKey = (typeof DIMENSION_FILTER_KEYS)[number];

/** Contexto determinístico dos filtros (data de referência de "novas empresas"). */
export type FilterContext = { referenceDate?: string };

/** Acima deste número de linhas renderizadas a tabela passa a ser virtualizada. */
export const VIRTUALIZATION_THRESHOLD = 100;
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 0] as const; // 0 = todas

/**
 * Sujeito mínimo dos filtros. Lista (CompanyListItem) e Mapa (MapCompany) são
 * convertidos para este formato, então as MESMAS regras valem nas duas visões.
 */
export type CompanyFilterSubject = {
  cnpj: string;
  status: string | null;
  state: string | null;
  headquartersOrBranch: CompanyListItem["headquartersOrBranch"];
  hasPhone: boolean;
  hasMobilePhone: boolean;
  hasEmail: boolean;
  /** Texto pesquisável já concatenado (razão social, fantasia, cidade, CNAE…). */
  searchText: string;
  /** Campos das dimensões analíticas (mesmo valor na Lista e no Mapa). */
  municipalityKey: string | null;
  cnae: string | null;
  size: string | null;
  shareCapital: number | null;
  openedAt: string | null;
  /** Chaves pré-calculadas (opcional; Mapa e Inteligência indexam uma vez por carga). */
  keys?: FacetKeys;
};

function searchableText(item: CompanyListItem) {
  return [
    item.legalName,
    item.tradeName,
    item.cnpj,
    item.city,
    item.state,
    item.neighborhood,
    item.primaryCnae,
    item.primaryCnaeDescription,
    item.email,
    item.phone
  ]
    .filter(Boolean)
    .join(" ");
}

export function listItemToFilterSubject(item: CompanyListItem): CompanyFilterSubject {
  return {
    cnpj: item.cnpj,
    status: item.status,
    state: item.state,
    headquartersOrBranch: item.headquartersOrBranch,
    hasPhone: Boolean(item.phone),
    hasMobilePhone: Boolean(item.phone && item.phoneIsMobile),
    hasEmail: Boolean(item.email),
    searchText: searchableText(item),
    municipalityKey: item.municipalityKey ?? null,
    cnae: item.primaryCnae,
    size: item.size,
    shareCapital: item.shareCapital,
    openedAt: item.openedAt
  };
}

function subjectMatchesQuery(subject: CompanyFilterSubject, query: string) {
  const folded = foldText(query);
  if (!folded) return true;
  const haystack = subject.keys?.search ?? foldText(subject.searchText);
  const digitsQuery = folded.replace(/[^0-9a-z]/g, "");
  if (digitsQuery.length >= 4 && /\d/.test(digitsQuery) && subject.cnpj.toLowerCase().includes(digitsQuery)) return true;
  return folded.split(" ").every((term) => haystack.includes(term));
}

/** Busca livre: todos os termos precisam aparecer (sem acento, sem caixa). CNPJ aceita máscara. */
export function matchesQuery(item: CompanyListItem, query: string) {
  return subjectMatchesQuery(listItemToFilterSubject(item), query);
}

function matchesStatus(status: string | null, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "active") return isActiveStatus(status);
  if (filter === "inactive") return !isActiveStatus(status);
  return statusKey(status) === filter;
}

function matchesContact(subject: CompanyFilterSubject, filter: ContactFilter) {
  if (filter === "any") return subject.hasPhone || subject.hasEmail;
  if (filter === "phone") return subject.hasPhone;
  if (filter === "mobile") return subject.hasMobilePhone;
  if (filter === "email") return subject.hasEmail;
  return true;
}

/**
 * Filtros que também são dimensões de gráfico ("facetas"). Na Inteligência, o gráfico de
 * uma dimensão é calculado com TODOS os filtros menos o dela (padrão "cross-filter"
 * do Superset): o segmento escolhido aparece destacado entre os demais, em vez de o
 * gráfico colapsar numa barra só.
 */
export const FACET_FILTER_KEYS = ["status", "state", "municipality", "cnae", "size", "capital", "opened"] as const;
export type FacetFilterKey = (typeof FACET_FILTER_KEYS)[number];

export function matchesFacet(subject: CompanyFilterSubject, key: FacetFilterKey, filters: CompanyTableFilters, referenceDate: string) {
  const keys = subject.keys;
  if (keys) {
    switch (key) {
      case "status":
        return filters.status === "all"
          ? true
          : filters.status === "active"
            ? keys.status === "ativa"
            : filters.status === "inactive"
              ? keys.status !== "ativa"
              : keys.status === filters.status;
      case "state":
        return filters.state === "all" || (subject.state ?? "") === filters.state;
      case "municipality":
        return (filters.municipality ?? "all") === "all" || keys.municipality === filters.municipality;
      case "cnae":
        return (filters.cnae ?? "all") === "all" || keys.cnae === filters.cnae;
      case "size":
        return (filters.size ?? "all") === "all" || keys.size === filters.size;
      case "capital":
        return (filters.capital ?? "all") === "all" || keys.capital === filters.capital;
      case "opened":
        return (filters.opened ?? "all") === "all" || matchesOpenedKeys(keys, filters.opened, referenceDate);
    }
  }
  switch (key) {
    case "status":
      return matchesStatus(subject.status, filters.status);
    case "state":
      return filters.state === "all" || (subject.state ?? "") === filters.state;
    case "municipality": {
      const value = filters.municipality ?? "all";
      return value === "all" || municipalityDimensionKey(subject.municipalityKey) === value;
    }
    case "cnae": {
      const value = filters.cnae ?? "all";
      return value === "all" || cnaeKey(subject.cnae) === value;
    }
    case "size": {
      const value = filters.size ?? "all";
      return value === "all" || sizeKey(subject.size) === value;
    }
    case "capital": {
      const value = filters.capital ?? "all";
      return value === "all" || capitalBandKey(subject.shareCapital) === value;
    }
    case "opened": {
      const value = filters.opened ?? "all";
      return value === "all" || matchesOpenedFilter(subject.openedAt, value, referenceDate);
    }
  }
}

/** Filtros que não são facetas: busca textual, contato e matriz/filial. */
export function matchesBaseFilters(subject: CompanyFilterSubject, filters: CompanyTableFilters) {
  if (!matchesContact(subject, filters.contact)) return false;
  if (filters.branch !== "all" && subject.headquartersOrBranch !== filters.branch) return false;
  return subjectMatchesQuery(subject, filters.query);
}

/** Regra única de filtros (Lista, Mapa e Inteligência). */
export function subjectMatchesFilters(subject: CompanyFilterSubject, filters: CompanyTableFilters, context: FilterContext = {}) {
  const referenceDate = context.referenceDate ?? analysisReferenceDate();
  for (const key of FACET_FILTER_KEYS) if (!matchesFacet(subject, key, filters, referenceDate)) return false;
  return matchesBaseFilters(subject, filters);
}

export function matchesFilters(item: CompanyListItem, filters: CompanyTableFilters, context: FilterContext = {}) {
  return subjectMatchesFilters(listItemToFilterSubject(item), filters, context);
}

export function filterCompanyListItems(items: CompanyListItem[], filters: CompanyTableFilters, context: FilterContext = {}) {
  const resolved = { referenceDate: context.referenceDate ?? analysisReferenceDate() };
  return items.filter((item) => matchesFilters(item, filters, resolved));
}

export function hasActiveFilters(filters: CompanyTableFilters) {
  return (
    foldText(filters.query) !== "" ||
    filters.status !== "all" ||
    filters.contact !== "all" ||
    filters.state !== "all" ||
    filters.branch !== "all" ||
    hasDimensionFilters(filters)
  );
}

export function hasDimensionFilters(filters: CompanyTableFilters) {
  return DIMENSION_FILTER_KEYS.some((key) => (filters[key] ?? "all") !== "all");
}

/** Remove um filtro de dimensão (chip "×"). */
export function clearDimensionFilter(filters: CompanyTableFilters, key: DimensionFilterKey | "status" | "state"): CompanyTableFilters {
  return { ...filters, [key]: "all" };
}

export { NOT_INFORMED };

export function listStates(items: CompanyListItem[]) {
  return Array.from(new Set(items.map((item) => item.state).filter((value): value is string => Boolean(value)))).sort();
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/** Comparador estável: valores ausentes sempre ao final, independente da direção. */
export function compareNullable<T extends string | number>(left: T | null | undefined, right: T | null | undefined) {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return collator.compare(String(left), String(right));
}

export function formatCnpjDigits(value: string) {
  const input = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (input.length !== 14) return value;
  return `${input.slice(0, 2)}.${input.slice(2, 5)}.${input.slice(5, 8)}/${input.slice(8, 12)}-${input.slice(12, 14)}`;
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "boolean" ? (value ? "Sim" : "Não") : String(value);
  // Neutraliza fórmulas (CSV injection) e escapa aspas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV (separador ";" para Excel pt-BR) das linhas selecionadas, a partir do modelo normalizado. */
export function buildCompanyCsv(items: CompanyListItem[]) {
  const header = [
    "Posição",
    "CNPJ",
    "Razão social",
    "Nome fantasia",
    "Matriz/Filial",
    "Situação",
    "Abertura",
    "CNAE principal",
    "Descrição CNAE",
    "Porte",
    "Capital social",
    "Telefone",
    "E-mail",
    "Site",
    "Endereço",
    "Bairro",
    "Cidade",
    "UF",
    "CEP"
  ];
  const lines = items.map((item) =>
    [
      item.position,
      formatCnpjDigits(item.cnpj),
      item.legalName,
      item.tradeName,
      item.headquartersOrBranch === "matriz" ? "Matriz" : item.headquartersOrBranch === "filial" ? "Filial" : "",
      item.status,
      item.openedAt,
      item.primaryCnae,
      item.primaryCnaeDescription,
      item.size,
      item.shareCapital,
      item.phone,
      item.email,
      item.website,
      item.addressSummary,
      item.neighborhood,
      item.city,
      item.state,
      item.postalCode
    ]
      .map(csvCell)
      .join(";")
  );
  return `﻿${[header.join(";"), ...lines].join("\r\n")}`;
}
