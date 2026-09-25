"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CompanyListItem } from "@/lib/company-model";
import {
  DEFAULT_COMPANY_TABLE_FILTERS,
  PAGE_SIZE_OPTIONS,
  VIRTUALIZATION_THRESHOLD,
  buildCompanyCsv,
  compareNullable,
  filterCompanyListItems,
  formatCnpjDigits,
  hasActiveFilters,
  isActiveStatus,
  listStates,
  type CompanyTableFilters
} from "@/lib/results/company-table-model";


/**
 * Tabela de resultados empresariais.
 *
 * - TanStack Table (v9): ordenação e paginação sobre o modelo normalizado (CompanyListItem).
 * - Filtros aplicados antes da tabela por funções puras (lib/results/company-table-model.ts).
 * - TanStack Virtual: acima de VIRTUALIZATION_THRESHOLD linhas visíveis ("Todas"), só as
 *   linhas na área rolável são montadas no DOM.
 * - Seleção própria (Set de ids) para operar sobre as linhas filtradas: salvar na carteira,
 *   copiar CNPJs e baixar CSV da seleção.
 */

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel()
});

const columnHelper = createColumnHelper<typeof features, CompanyListItem>();

type Variant = "dashboard" | "order";

type CompanyResultsTableProps = {
  items: CompanyListItem[];
  variant: Variant;
  /** Texto do cabeçalho acessível da tabela. */
  caption: string;
  /** Link para a ficha completa (somente no dashboard autenticado). */
  showCompanyLink?: boolean;
  /**
   * Server actions da carteira (somente no dashboard autenticado), recebidas por props
   * para manter este componente desacoplado do servidor (e testável).
   */
  saveSelectionAction?: (establishmentIds: string[]) => Promise<{ ok: boolean; saved: number; error?: string }>;
  toggleSavedAction?: (formData: FormData) => Promise<void>;
  /** Nome base do arquivo CSV da seleção. */
  csvFileName?: string;
};

const numberFormatter = new Intl.NumberFormat("pt-BR");
const moneyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

function formatOpenedAt(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function yearOf(value: string | null) {
  const match = value?.match(/^(\d{4})|\/(\d{4})$/);
  return match ? Number(match[1] ?? match[2]) : null;
}

function branchLabel(value: CompanyListItem["headquartersOrBranch"]) {
  return value === "matriz" ? "Matriz" : value === "filial" ? "Filial" : null;
}

function SortIndicator({ state }: { state: false | "asc" | "desc" }) {
  if (!state) return <span className="sort-indicator" aria-hidden="true">↕</span>;
  return (
    <span className="sort-indicator is-active" aria-hidden="true">
      {state === "asc" ? "↑" : "↓"}
    </span>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="results-checkbox"
      checked={checked}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/** Mesmo formulário do LeadToggleForm (components/lead-toggle-form.tsx), com a action por props. */
function SavedToggle({
  action,
  establishmentId,
  isSaved
}: {
  action: (formData: FormData) => Promise<void>;
  establishmentId: string;
  isSaved: boolean;
}) {
  return (
    <form action={action} data-analytics-event={isSaved ? "saved_lead_removed" : "saved_lead_added"}>
      <input type="hidden" name="establishmentId" value={establishmentId} />
      <input type="hidden" name="intent" value={isSaved ? "remove" : "save"} />
      <button className={`${isSaved ? "button-danger" : "button-secondary"} button-sm`} type="submit">
        {isSaved ? "Remover da carteira" : "Salvar na carteira"}
      </button>
    </form>
  );
}

function DetailList({ item }: { item: CompanyListItem }) {
  const rows: Array<[string, string | null]> = [
    ["Natureza jurídica", item.legalNature],
    ["Matriz/filial", branchLabel(item.headquartersOrBranch)],
    ["Porte", item.size],
    ["Capital social", item.shareCapital !== null ? moneyFormatter.format(item.shareCapital) : null],
    ["Simples", item.simplesOptIn === null ? null : item.simplesOptIn ? "Optante" : "Não optante"],
    ["MEI", item.meiOptIn === null ? null : item.meiOptIn ? "Sim" : "Não"],
    ["Abertura", formatOpenedAt(item.openedAt)],
    ["CNAE principal", [item.primaryCnae, item.primaryCnaeDescription].filter(Boolean).join(" - ") || null],
    ["CNAEs secundários", item.secondaryCnaes.length > 0 ? item.secondaryCnaes.join(" • ") : null],
    ["Endereço", item.addressSummary],
    ["Site", item.website]
  ];

  return (
    <dl className="kv-list results-detail">
      {rows.map(([label, value]) => (
        <div key={label} className="kv-row">
          <dt>{label}</dt>
          <dd className={value ? undefined : "is-missing"}>{value ?? "Não retornado pela fonte"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CompanyResultsTable({
  items,
  variant,
  caption,
  showCompanyLink = false,
  saveSelectionAction,
  toggleSavedAction,
  csvFileName = "empresas-selecionadas"
}: CompanyResultsTableProps) {
  const baseId = useId();
  const [filters, setFilters] = useState<CompanyTableFilters>(DEFAULT_COMPANY_TABLE_FILTERS);
  // A busca textual é "adiada" para não travar a digitação em listas grandes.
  const deferredQuery = useDeferredValue(filters.query);
  const effectiveFilters = useMemo(() => ({ ...filters, query: deferredQuery }), [filters, deferredQuery]);
  const filtered = useMemo(() => filterCompanyListItems(items, effectiveFilters), [items, effectiveFilters]);
  const states = useMemo(() => listStates(items), [items]);
  const hasBranchData = useMemo(() => items.some((item) => item.headquartersOrBranch !== null), [items]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pageSizeChoice, setPageSizeChoice] = useState<number>(25);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  // Ids salvos em lote nesta sessão; o estado "salvo" definitivo vem do servidor (items).
  const [bulkSavedIds, setBulkSavedIds] = useState<Set<string>>(() => new Set());
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    setBulkSavedIds(new Set());
  }, [items]);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("position", {
          id: "position",
          header: "#",
          sortFn: (a, b) => a.original.position - b.original.position
        }),
        columnHelper.accessor("legalName", {
          id: "company",
          header: "Empresa",
          sortFn: (a, b) => compareNullable(a.original.tradeName || a.original.legalName, b.original.tradeName || b.original.legalName)
        }),
        columnHelper.accessor("cnpj", { id: "cnpj", header: "CNPJ", enableSorting: false }),
        columnHelper.accessor((row) => `${row.city ?? ""}/${row.state ?? ""}`, {
          id: "location",
          header: "Cidade/UF",
          sortFn: (a, b) =>
            compareNullable(a.original.state, b.original.state) || compareNullable(a.original.city, b.original.city)
        }),
        columnHelper.accessor((row) => row.phone ?? row.email ?? "", { id: "contact", header: "Contato", enableSorting: false }),
        columnHelper.accessor("openedAt", {
          id: "openedAt",
          header: "Abertura",
          sortFn: (a, b) => compareNullable(a.original.openedAt, b.original.openedAt)
        }),
        columnHelper.accessor("shareCapital", {
          id: "shareCapital",
          header: "Capital",
          sortFn: (a, b) => compareNullable(a.original.shareCapital, b.original.shareCapital)
        }),
        columnHelper.accessor("status", {
          id: "status",
          header: "Situação",
          sortFn: (a, b) => compareNullable(a.original.status, b.original.status)
        })
      ]),
    []
  );

  const table = useTable(
    {
      features,
      columns,
      data: filtered,
      getRowId: (row) => row.id,
      initialState: {
        sorting: [{ id: "position", desc: false }],
        pagination: { pageIndex: 0, pageSize: 25 }
      },
      enableMultiSort: false,
      enableSortingRemoval: false,
      autoResetPageIndex: true
    },
    (state) => ({ sorting: state.sorting, pagination: state.pagination })
  );

  // "Todas" = uma página com todas as linhas filtradas (virtualizada se necessário).
  useEffect(() => {
    const size = pageSizeChoice === 0 ? Math.max(filtered.length, 1) : pageSizeChoice;
    if (table.state.pagination.pageSize !== size) table.setPageSize(size);
  }, [pageSizeChoice, filtered.length, table]);

  useEffect(() => {
    table.setPageIndex(0);
  }, [effectiveFilters, table]);

  const rows = table.getRowModel().rows;
  const virtualize = rows.length > VIRTUALIZATION_THRESHOLD;
  const scrollRef = useRef<HTMLDivElement>(null);
  // O virtualizador expõe funções não memoizáveis; o componente não depende do React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index
  });

  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const paddingTop = virtualize && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualize && virtualItems.length > 0 ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;
  const renderedRows = virtualize ? virtualItems.map((item) => ({ row: rows[item.index], index: item.index })) : rows.map((row, index) => ({ row, index }));

  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selectedInFilter = filteredIds.filter((id) => selected.has(id)).length;
  const allFilteredSelected = filteredIds.length > 0 && selectedInFilter === filteredIds.length;
  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);

  const toggleAllFiltered = useCallback(
    (checked: boolean) => {
      setSelected((current) => {
        const next = new Set(current);
        for (const id of filteredIds) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [filteredIds]
  );

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function updateFilter<K extends keyof CompanyTableFilters>(key: K, value: CompanyTableFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function downloadCsv() {
    if (selectedItems.length === 0) return;
    const blob = new Blob([buildCompanyCsv(selectedItems)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${csvFileName}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback({ tone: "success", text: `CSV com ${numberFormatter.format(selectedItems.length)} empresa(s) gerado.` });
  }

  async function copyCnpjs() {
    if (selectedItems.length === 0) return;
    try {
      await navigator.clipboard.writeText(selectedItems.map((item) => formatCnpjDigits(item.cnpj)).join("\n"));
      setFeedback({ tone: "success", text: `${numberFormatter.format(selectedItems.length)} CNPJ(s) copiados.` });
    } catch {
      setFeedback({ tone: "danger", text: "Não foi possível acessar a área de transferência deste navegador." });
    }
  }

  function saveSelection() {
    const ids = selectedItems.map((item) => item.id);
    if (ids.length === 0 || !saveSelectionAction) return;
    startSaving(async () => {
      const result = await saveSelectionAction(ids);
      if (result.ok) {
        setBulkSavedIds((current) => new Set([...current, ...ids]));
        setFeedback({ tone: "success", text: `${numberFormatter.format(result.saved)} empresa(s) salvas na carteira.` });
      } else {
        setFeedback({ tone: "danger", text: result.error ?? "Não foi possível salvar a seleção." });
      }
    });
  }

  const totalColumns = 10;
  const filtersActive = hasActiveFilters(filters);
  const pageCount = table.getPageCount();
  const { pageIndex } = table.state.pagination;

  return (
    <div className="results-table-shell stack-lg">
      <div className="results-toolbar" role="search" aria-label="Filtrar resultados">
        <div className="field results-toolbar-search">
          <label htmlFor={`${baseId}-q`}>Buscar na lista</label>
          <input
            id={`${baseId}-q`}
            className="input"
            type="search"
            inputMode="search"
            placeholder="Nome, CNPJ, cidade, bairro, CNAE…"
            value={filters.query}
            onChange={(event) => updateFilter("query", event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${baseId}-status`}>Situação</label>
          <select id={`${baseId}-status`} className="input" value={filters.status} onChange={(event) => updateFilter("status", event.target.value as CompanyTableFilters["status"])}>
            <option value="all">Todas</option>
            <option value="active">Ativas</option>
            <option value="inactive">Outras situações</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${baseId}-contact`}>Contato</label>
          <select id={`${baseId}-contact`} className="input" value={filters.contact} onChange={(event) => updateFilter("contact", event.target.value as CompanyTableFilters["contact"])}>
            <option value="all">Qualquer</option>
            <option value="any">Com telefone ou e-mail</option>
            <option value="phone">Com telefone</option>
            <option value="mobile">Com celular</option>
            <option value="email">Com e-mail</option>
          </select>
        </div>
        {states.length > 1 ? (
          <div className="field">
            <label htmlFor={`${baseId}-uf`}>UF</label>
            <select id={`${baseId}-uf`} className="input" value={filters.state} onChange={(event) => updateFilter("state", event.target.value)}>
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
            <label htmlFor={`${baseId}-branch`}>Estabelecimento</label>
            <select id={`${baseId}-branch`} className="input" value={filters.branch} onChange={(event) => updateFilter("branch", event.target.value as CompanyTableFilters["branch"])}>
              <option value="all">Matriz e filiais</option>
              <option value="matriz">Somente matriz</option>
              <option value="filial">Somente filiais</option>
            </select>
          </div>
        ) : null}
      </div>

      <div className="results-summary cluster-between">
        <p className="footnote" aria-live="polite" aria-atomic="true">
          {filtersActive
            ? `${numberFormatter.format(filtered.length)} de ${numberFormatter.format(items.length)} empresas`
            : `${numberFormatter.format(items.length)} empresas`}
          {selected.size > 0 ? ` · ${numberFormatter.format(selected.size)} selecionada(s)` : ""}
        </p>
        {filtersActive ? (
          <button type="button" className="button-ghost button-sm" onClick={() => setFilters(DEFAULT_COMPANY_TABLE_FILTERS)}>
            Limpar filtros
          </button>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div className="results-selection-bar cluster" role="region" aria-label="Ações da seleção">
          <strong className="footnote">{numberFormatter.format(selected.size)} selecionada(s)</strong>
          {saveSelectionAction ? (
            <button type="button" className="button-secondary button-sm" onClick={saveSelection} aria-busy={isSaving} disabled={isSaving}>
              Salvar na carteira
            </button>
          ) : null}
          <button type="button" className="button-secondary button-sm" onClick={downloadCsv}>
            Baixar CSV da seleção
          </button>
          <button type="button" className="button-ghost button-sm" onClick={copyCnpjs}>
            Copiar CNPJs
          </button>
          <button type="button" className="button-ghost button-sm is-neutral" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </button>
        </div>
      ) : null}

      {feedback ? (
        <div className={`notice ${feedback.tone}`} role={feedback.tone === "danger" ? "alert" : "status"}>
          {feedback.text}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className={`table-wrap results-table-wrap${virtualize ? " is-virtualized" : ""}`}
        tabIndex={virtualize ? 0 : undefined}
        aria-label={virtualize ? `${caption} (rolável)` : undefined}
        role={virtualize ? "region" : undefined}
      >
        <table className="table table-responsive results-table" aria-rowcount={filtered.length + 1}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="cell-select">
                <SelectionCheckbox
                  checked={allFilteredSelected}
                  indeterminate={selectedInFilter > 0}
                  onChange={toggleAllFiltered}
                  label={filtersActive ? "Selecionar todas as empresas filtradas" : "Selecionar todas as empresas"}
                />
              </th>
              {table.getHeaderGroups()[0].headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined}
                    className={header.id === "shareCapital" ? "cell-num cell-hide-sm" : header.id === "openedAt" ? "cell-hide-sm" : undefined}
                  >
                    {canSort ? (
                      <button type="button" className="sort-button" onClick={header.column.getToggleSortingHandler()}>
                        <table.FlexRender header={header} />
                        <SortIndicator state={sorted} />
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
              <th scope="col" className="cell-actions">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>

          {paddingTop > 0 ? (
            <tbody aria-hidden="true">
              <tr className="results-spacer" style={{ height: paddingTop }} />
            </tbody>
          ) : null}

          {renderedRows.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={totalColumns} data-label="">
                  <div className="results-empty stack-sm">
                    <strong>Nenhuma empresa corresponde aos filtros.</strong>
                    <button type="button" className="button-ghost button-sm" onClick={() => setFilters(DEFAULT_COMPANY_TABLE_FILTERS)}>
                      Limpar filtros
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          ) : null}

          {renderedRows.map(({ row, index }) => {
            const item = row.original;
            const isSelected = selected.has(item.id);
            const isExpanded = expanded.has(item.id);
            const detailId = `${baseId}-detail-${item.id}`;
            const branch = branchLabel(item.headquartersOrBranch);
            const active = isActiveStatus(item.status);

            return (
              <tbody
                key={row.id}
                data-index={index}
                ref={virtualize ? virtualizer.measureElement : undefined}
                className={isSelected ? "is-selected" : undefined}
              >
                <tr aria-rowindex={index + 2}>
                  <td className="cell-select" data-label="">
                    <SelectionCheckbox
                      checked={isSelected}
                      onChange={(checked) => toggleOne(item.id, checked)}
                      label={`Selecionar ${item.tradeName || item.legalName}`}
                    />
                  </td>
                  <td data-label="#" className="subtle numeric">
                    {item.position}
                  </td>
                  <td data-label="Empresa">
                    <div className="cell-stack">
                      <strong>{item.legalName}</strong>
                      <span className="muted">{item.tradeName ?? "Nome fantasia não informado"}</span>
                      {branch ? <span className="pill results-pill">{branch}</span> : null}
                    </div>
                  </td>
                  <td data-label="CNPJ" className="cell-nowrap numeric">
                    {formatCnpjDigits(item.cnpj)}
                  </td>
                  <td data-label="Cidade/UF">
                    <div className="cell-stack">
                      <span>{item.city ?? "-"}/{item.state ?? "-"}</span>
                      {item.neighborhood ? <span className="muted">{item.neighborhood}</span> : null}
                    </div>
                  </td>
                  <td data-label="Contato">
                    <div className="cell-stack">
                      <span className={item.phone ? undefined : "is-missing"}>{item.phone ?? "Sem telefone"}</span>
                      <span className={item.email ? "muted" : "muted is-missing"}>{item.email ?? "Sem e-mail"}</span>
                    </div>
                  </td>
                  <td data-label="Abertura" className="cell-nowrap cell-hide-sm">
                    {formatOpenedAt(item.openedAt) ?? "-"}
                    {yearOf(item.openedAt) ? <span className="sr-only"> ({yearOf(item.openedAt)})</span> : null}
                  </td>
                  <td data-label="Capital" className="cell-num cell-hide-sm">
                    {item.shareCapital !== null ? moneyFormatter.format(item.shareCapital) : "-"}
                  </td>
                  <td data-label="Situação">
                    {item.status ? <span className={`pill ${active ? "success" : "warning"}`}>{item.status}</span> : "-"}
                  </td>
                  <td data-label="" className="cell-actions">
                    <div className="table-actions">
                      <button
                        type="button"
                        className="button-ghost button-sm"
                        aria-expanded={isExpanded}
                        aria-controls={detailId}
                        onClick={() => toggleExpanded(item.id)}
                      >
                        {isExpanded ? "Ocultar" : "Detalhes"}
                      </button>
                      {showCompanyLink ? (
                        <Link href={`/dashboard/companies/${encodeURIComponent(item.cnpj)}`} className="button-ghost button-sm" prefetch={false}>
                          Ver ficha
                        </Link>
                      ) : null}
                      {toggleSavedAction && variant === "dashboard" ? (
                        <SavedToggle
                          action={toggleSavedAction}
                          establishmentId={item.id}
                          isSaved={item.saved || bulkSavedIds.has(item.id)}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
                {isExpanded ? (
                  <tr className="row-details-row">
                    <td colSpan={totalColumns} data-label="" id={detailId}>
                      <DetailList item={item} />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            );
          })}

          {paddingBottom > 0 ? (
            <tbody aria-hidden="true">
              <tr className="results-spacer" style={{ height: paddingBottom }} />
            </tbody>
          ) : null}
        </table>
      </div>

      <nav className="results-pagination cluster-between" aria-label="Paginação dos resultados">
        <div className="field results-page-size">
          <label htmlFor={`${baseId}-size`}>Linhas por página</label>
          <select
            id={`${baseId}-size`}
            className="input"
            value={pageSizeChoice}
            onChange={(event) => setPageSizeChoice(Number(event.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size === 0 ? "Todas" : size}
              </option>
            ))}
          </select>
        </div>
        {pageCount > 1 ? (
          <div className="cluster">
            <button type="button" className="button-ghost button-sm" onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()} aria-label="Primeira página">
              «
            </button>
            <button type="button" className="button-secondary button-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Anterior
            </button>
            <span className="footnote numeric" aria-current="page">
              Página {pageIndex + 1} de {pageCount}
            </span>
            <button type="button" className="button-secondary button-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Próxima
            </button>
            <button type="button" className="button-ghost button-sm" onClick={() => table.lastPage()} disabled={!table.getCanNextPage()} aria-label="Última página">
              »
            </button>
          </div>
        ) : null}
      </nav>
    </div>
  );
}
