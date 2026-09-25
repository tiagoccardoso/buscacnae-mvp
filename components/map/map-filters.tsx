"use client";

import { DEFAULT_COMPANY_TABLE_FILTERS, type CompanyTableFilters } from "@/lib/results/company-table-model";
import { ActiveFilterChips, ExactStatusOption, type FilterLabelLookup } from "@/components/analytics/active-filter-chips";

type MapFiltersProps = {
  idPrefix: string;
  filters: CompanyTableFilters;
  states: string[];
  hasBranchData: boolean;
  resultCount: number;
  totalCount: number;
  active: boolean;
  onChange(next: CompanyTableFilters): void;
  /** Rótulos dos filtros de drill-down (município, CNAE, porte, situação exata). */
  lookup?: FilterLabelLookup;
  /** Rótulo do contador (padrão: "empresas"). */
  unitLabel?: string;
};

const numberFormat = new Intl.NumberFormat("pt-BR");

/**
 * Filtros do mapa: os mesmos da tabela de resultados (mesmas opções, mesmos nomes na URL
 * e mesma regra em lib/results/company-table-model.ts). Atuam sobre os resultados já
 * carregados da busca — não disparam nova consulta à Casa dos Dados.
 */
export function MapFilters({
  idPrefix,
  filters,
  states,
  hasBranchData,
  resultCount,
  totalCount,
  active,
  onChange,
  lookup,
  unitLabel = "empresas"
}: MapFiltersProps) {
  function update<K extends keyof CompanyTableFilters>(key: K, value: CompanyTableFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <fieldset className="map-filters">
      <legend className="field-label">Filtrar resultados</legend>
      <div className="field">
        <label htmlFor={`${idPrefix}-query`} className="sr-only">
          Buscar por nome, CNPJ, cidade ou CNAE
        </label>
        <input
          id={`${idPrefix}-query`}
          type="search"
          className="input"
          placeholder="Nome, CNPJ, cidade ou CNAE"
          value={filters.query}
          onChange={(event) => update("query", event.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="map-filters-grid">
        <div className="field">
          <label htmlFor={`${idPrefix}-status`} className="field-label">
            Situação
          </label>
          <select
            id={`${idPrefix}-status`}
            className="input"
            value={filters.status}
            onChange={(event) => update("status", event.target.value as CompanyTableFilters["status"])}
          >
            <option value="all">Todas</option>
            <option value="active">Ativas</option>
            <option value="inactive">Outras situações</option>
            <ExactStatusOption status={filters.status} lookup={lookup} />
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-contact`} className="field-label">
            Contato
          </label>
          <select
            id={`${idPrefix}-contact`}
            className="input"
            value={filters.contact}
            onChange={(event) => update("contact", event.target.value as CompanyTableFilters["contact"])}
          >
            <option value="all">Qualquer</option>
            <option value="any">Com telefone ou e-mail</option>
            <option value="phone">Com telefone</option>
            <option value="mobile">Com celular</option>
            <option value="email">Com e-mail</option>
          </select>
        </div>
        {states.length > 1 ? (
          <div className="field">
            <label htmlFor={`${idPrefix}-uf`} className="field-label">
              UF
            </label>
            <select id={`${idPrefix}-uf`} className="input" value={filters.state} onChange={(event) => update("state", event.target.value)}>
              <option value="all">Todas</option>
              {states.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {hasBranchData ? (
          <div className="field">
            <label htmlFor={`${idPrefix}-branch`} className="field-label">
              Estabelecimento
            </label>
            <select
              id={`${idPrefix}-branch`}
              className="input"
              value={filters.branch}
              onChange={(event) => update("branch", event.target.value as CompanyTableFilters["branch"])}
            >
              <option value="all">Matriz e filiais</option>
              <option value="matriz">Somente matriz</option>
              <option value="filial">Somente filiais</option>
            </select>
          </div>
        ) : null}
      </div>
      <ActiveFilterChips filters={filters} onChange={onChange} lookup={lookup} />
      <div className="map-filters-foot" aria-live="polite">
        <span className="footnote">
          {active
            ? `${numberFormat.format(resultCount)} de ${numberFormat.format(totalCount)} ${unitLabel}`
            : `${numberFormat.format(totalCount)} ${unitLabel}`}
        </span>
        {active ? (
          <button type="button" className="button-ghost button-sm" onClick={() => onChange(DEFAULT_COMPANY_TABLE_FILTERS)}>
            Limpar filtros
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
