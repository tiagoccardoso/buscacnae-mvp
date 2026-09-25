import type { CompanyListItem } from "@/lib/company-model";

/**
 * Regras puras da tabela de resultados (sem React), compartilhadas pelo componente
 * client e pelos testes. Filtros atuam sobre o modelo normalizado (CompanyListItem).
 */

export type StatusFilter = "all" | "active" | "inactive";
export type ContactFilter = "all" | "any" | "phone" | "mobile" | "email";
export type BranchFilter = "all" | "matriz" | "filial";

export type CompanyTableFilters = {
  query: string;
  status: StatusFilter;
  contact: ContactFilter;
  state: string;
  branch: BranchFilter;
};

export const DEFAULT_COMPANY_TABLE_FILTERS: CompanyTableFilters = {
  query: "",
  status: "all",
  contact: "all",
  state: "all",
  branch: "all"
};

/** Acima deste número de linhas renderizadas a tabela passa a ser virtualizada. */
export const VIRTUALIZATION_THRESHOLD = 100;
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 0] as const; // 0 = todas

export function foldText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isActiveStatus(status: string | null | undefined) {
  return foldText(status) === "ativa";
}

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
    searchText: searchableText(item)
  };
}

function subjectMatchesQuery(subject: CompanyFilterSubject, query: string) {
  const folded = foldText(query);
  if (!folded) return true;
  const haystack = foldText(subject.searchText);
  const digitsQuery = folded.replace(/[^0-9a-z]/g, "");
  if (digitsQuery.length >= 4 && /\d/.test(digitsQuery) && subject.cnpj.toLowerCase().includes(digitsQuery)) return true;
  return folded.split(" ").every((term) => haystack.includes(term));
}

/** Busca livre: todos os termos precisam aparecer (sem acento, sem caixa). CNPJ aceita máscara. */
export function matchesQuery(item: CompanyListItem, query: string) {
  return subjectMatchesQuery(listItemToFilterSubject(item), query);
}

/** Regra única de filtros (Lista e Mapa). */
export function subjectMatchesFilters(subject: CompanyFilterSubject, filters: CompanyTableFilters) {
  if (filters.status === "active" && !isActiveStatus(subject.status)) return false;
  if (filters.status === "inactive" && isActiveStatus(subject.status)) return false;

  if (filters.contact === "any" && !subject.hasPhone && !subject.hasEmail) return false;
  if (filters.contact === "phone" && !subject.hasPhone) return false;
  if (filters.contact === "mobile" && !subject.hasMobilePhone) return false;
  if (filters.contact === "email" && !subject.hasEmail) return false;

  if (filters.state !== "all" && (subject.state ?? "") !== filters.state) return false;
  if (filters.branch !== "all" && subject.headquartersOrBranch !== filters.branch) return false;

  return subjectMatchesQuery(subject, filters.query);
}

export function matchesFilters(item: CompanyListItem, filters: CompanyTableFilters) {
  return subjectMatchesFilters(listItemToFilterSubject(item), filters);
}

export function filterCompanyListItems(items: CompanyListItem[], filters: CompanyTableFilters) {
  return items.filter((item) => matchesFilters(item, filters));
}

export function hasActiveFilters(filters: CompanyTableFilters) {
  return (
    foldText(filters.query) !== "" ||
    filters.status !== "all" ||
    filters.contact !== "all" ||
    filters.state !== "all" ||
    filters.branch !== "all"
  );
}

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
