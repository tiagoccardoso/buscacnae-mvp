"use client";

import {
  NOT_INFORMED,
  capitalBandLabel,
  formatCnaeCode,
  openedFilterLabel
} from "@/lib/analytics/dimensions";
import { DIMENSION_FILTER_KEYS, type CompanyTableFilters, type DimensionFilterKey } from "@/lib/results/company-table-model";

/** Rótulos legíveis das chaves (município → "Campinas/SP", CNAE → descrição, porte → rótulo original). */
export type FilterLabelLookup = {
  municipality?: ReadonlyMap<string, string>;
  cnae?: ReadonlyMap<string, string>;
  size?: ReadonlyMap<string, string>;
  status?: ReadonlyMap<string, string>;
};

const DIMENSION_TITLES: Record<DimensionFilterKey | "status", string> = {
  status: "Situação",
  municipality: "Município",
  cnae: "CNAE",
  size: "Porte",
  capital: "Capital social",
  opened: "Abertura"
};

/** Situação exata (drill-down) ≠ opções padrão do seletor. */
export function isExactStatusFilter(status: string) {
  return status !== "all" && status !== "active" && status !== "inactive";
}

export function describeFilterValue(key: DimensionFilterKey | "status", value: string, lookup: FilterLabelLookup = {}) {
  if (value === NOT_INFORMED) {
    if (key === "opened") return openedFilterLabel(value);
    if (key === "capital") return capitalBandLabel(value);
    return "Não informado";
  }
  switch (key) {
    case "status":
      return lookup.status?.get(value) ?? value.charAt(0).toUpperCase() + value.slice(1);
    case "municipality":
      return lookup.municipality?.get(value) ?? `IBGE ${value}`;
    case "cnae":
      return lookup.cnae?.get(value) ?? formatCnaeCode(value);
    case "size":
      return lookup.size?.get(value) ?? value.toUpperCase();
    case "capital":
      return capitalBandLabel(value);
    case "opened":
      return openedFilterLabel(value);
  }
}

/** Opção extra do seletor de situação quando a URL traz uma situação exata (ex.: "baixada"). */
export function ExactStatusOption({ status, lookup }: { status: string; lookup?: FilterLabelLookup }) {
  if (!isExactStatusFilter(status)) return null;
  return <option value={status}>{describeFilterValue("status", status, lookup)}</option>;
}

type ActiveFilterChipsProps = {
  filters: CompanyTableFilters;
  onChange(next: CompanyTableFilters): void;
  lookup?: FilterLabelLookup;
  className?: string;
};

/**
 * Filtros de drill-down ativos (como os "badges" de filtros aplicados do Superset).
 * Aparecem igual na Lista, no Mapa e na Inteligência; "×" remove só aquele filtro.
 */
export function ActiveFilterChips({ filters, onChange, lookup, className = "" }: ActiveFilterChipsProps) {
  const active = DIMENSION_FILTER_KEYS.filter((key) => (filters[key] ?? "all") !== "all");
  const exactStatus = isExactStatusFilter(filters.status);
  if (active.length === 0 && !exactStatus) return null;

  return (
    <ul className={`filter-chips ${className}`.trim()} aria-label="Filtros de análise aplicados">
      {exactStatus ? (
        <li className="filter-chip">
          <span>
            <span className="filter-chip-key">{DIMENSION_TITLES.status}:</span> {describeFilterValue("status", filters.status, lookup)}
          </span>
          <button type="button" className="filter-chip-remove" onClick={() => onChange({ ...filters, status: "all" })} aria-label="Remover filtro de situação">
            ×
          </button>
        </li>
      ) : null}
      {active.map((key) => (
        <li key={key} className="filter-chip">
          <span>
            <span className="filter-chip-key">{DIMENSION_TITLES[key]}:</span> {describeFilterValue(key, filters[key], lookup)}
          </span>
          <button
            type="button"
            className="filter-chip-remove"
            onClick={() => onChange({ ...filters, [key]: "all" })}
            aria-label={`Remover filtro de ${DIMENSION_TITLES[key].toLowerCase()}`}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
