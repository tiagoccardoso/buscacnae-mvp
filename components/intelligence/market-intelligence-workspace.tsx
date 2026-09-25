"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { MapFilters } from "@/components/map/map-filters";
import { useMapSearchData } from "@/components/map/use-map-search-data";
import { ChartCard, type ChartTableRow } from "@/components/intelligence/chart-card";
import { EChart, useChartPalette } from "@/components/intelligence/echart";
import { NOT_INFORMED, NEW_COMPANY_WINDOW_MONTHS, formatMonthKey } from "@/lib/analytics/dimensions";
import { buildFilterLabelMaps } from "@/lib/analytics/labels";
import { buildIntelligenceReport, formatShare, type Bucket, type Distribution, type TimePoint } from "@/lib/analytics/metrics";
import { toAnalyticsRecords } from "@/lib/analytics/records";
import { columnChartModel, rankingChartModel, type ChartPalette } from "@/lib/analytics/chart-options";
import { listMapStates } from "@/lib/map/filters";
import type { MapCompany, MapSearchData } from "@/lib/map/types";
import {
  DEFAULT_COMPANY_TABLE_FILTERS,
  hasActiveFilters,
  type CompanyTableFilters,
  type FacetFilterKey
} from "@/lib/results/company-table-model";
import { replaceUrlParams, writeCompanyFilters } from "@/lib/results/filter-params";
import { useAiCommands } from "@/lib/ai/ui-bus";

type MarketIntelligenceWorkspaceProps = {
  searchId: string;
  initialFilters?: CompanyTableFilters;
  /** Base dos links de drill-down (padrão: /dashboard/search/{id}). */
  resultsHref?: string;
  /** Valor de ?view= da Lista na base (padrão: nenhum). */
  listView?: string | null;
  /** Dados prontos (testes) ou endpoint alternativo (ambiente local /dev/mapa). */
  staticData?: MapSearchData | null;
  dataEndpoint?: string | null;
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const moneyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const DRILL_PREVIEW = 20;

/**
 * Inteligência de Mercado (Fase 3): indicadores e gráficos Apache ECharts sobre o MESMO
 * conjunto normalizado do Mapa (GET /api/map/searches/[id] → MapCompany), com os MESMOS
 * filtros da URL da Lista e do Mapa. Todo número é calculado de forma determinística por
 * lib/analytics/metrics.ts — nenhuma métrica é gerada por IA.
 *
 * Padrões do Apache Superset aplicados (sem incorporar o Superset):
 * - filtros globais numa barra única acima dos gráficos (valem para todos os gráficos);
 * - cross-filter: clicar num segmento filtra o painel inteiro; o gráfico de origem
 *   mantém as alternativas visíveis (usa todos os filtros menos o próprio);
 * - "badges" dos filtros aplicados, removíveis um a um;
 * - drill to detail: "Empresas correspondentes" mostra as linhas por trás do número e
 *   abre a Lista ou o Mapa já filtrados.
 */
export function MarketIntelligenceWorkspace({
  searchId,
  initialFilters,
  resultsHref,
  listView = null,
  staticData = null,
  dataEndpoint = null
}: MarketIntelligenceWorkspaceProps) {
  const { status, data, error, reload } = useMapSearchData(searchId, { staticData, endpoint: dataEndpoint });
  const [filters, setFilters] = useState<CompanyTableFilters>(initialFilters ?? DEFAULT_COMPANY_TABLE_FILTERS);
  const palette = useChartPalette();

  // Mesmo estado compartilhável da Lista e do Mapa (URL), sem navegar.
  useEffect(() => {
    replaceUrlParams((params) => {
      writeCompanyFilters(params, filters);
      params.delete("empresa");
      params.delete("camada");
    });
  }, [filters]);

  // Comandos do "Pergunte ao BuscaCNAE" (mesmo setFilters dos controles da tela).
  useAiCommands("inteligencia", (command) => setFilters(command.filters));

  const deferredQuery = useDeferredValue(filters.query);
  const effectiveFilters = useMemo(() => ({ ...filters, query: deferredQuery }), [filters, deferredQuery]);

  const companies = useMemo(() => data?.companies ?? [], [data]);
  const records = useMemo(() => toAnalyticsRecords(companies, data?.regions ?? []), [companies, data]);
  const labels = useMemo(() => buildFilterLabelMaps(records), [records]);
  const states = useMemo(() => listMapStates(companies), [companies]);
  const hasBranchData = useMemo(() => companies.some((company) => company.headquartersOrBranch !== null), [companies]);
  const referenceDate = data?.referenceDate ?? null;

  const report = useMemo(
    () => (referenceDate ? buildIntelligenceReport(records, effectiveFilters, referenceDate) : null),
    [records, effectiveFilters, referenceDate]
  );

  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const filtersActive = hasActiveFilters(filters);
  const filterQuery = writeCompanyFilters(new URLSearchParams(), filters).toString();
  const base = resultsHref ?? `/dashboard/search/${searchId}`;
  const listHref = withQuery(base, { view: listView }, filterQuery);
  const mapHref = withQuery(base, { view: "mapa" }, filterQuery);

  /** Clique num segmento: aplica o filtro da dimensão; clicar de novo remove (toggle). */
  const toggleFacet = useCallback((key: FacetFilterKey, value: string) => {
    setFilters((current) => {
      if (key === "status") {
        const selected = current.status === value || (value === "ativa" && current.status === "active");
        return { ...current, status: selected ? "all" : value };
      }
      const currentValue = current[key];
      return { ...current, [key]: currentValue === value ? "all" : value };
    });
  }, []);

  const clearFacet = useCallback((key: FacetFilterKey) => setFilters((current) => ({ ...current, [key]: "all" })), []);

  if (status === "loading" && !data) {
    return (
      <div className="intel-state" role="status">
        <span className="spinner" aria-hidden="true" /> Calculando indicadores…
      </div>
    );
  }

  if (status === "error" && !data) {
    return (
      <div className="notice danger" role="alert">
        <div className="stack-xs">
          <span>{error ?? "Não foi possível carregar os indicadores."}</span>
          <div>
            <button type="button" className="button-secondary button-sm" onClick={reload}>
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data || !report) return null;

  const summary = report.summary;
  const matchedCompanies = report.matchedIds
    .slice(0, DRILL_PREVIEW)
    .map((id) => companiesById.get(id))
    .filter((company): company is MapCompany => Boolean(company));

  // "Ativas"/"Outras situações" do seletor destacam os segmentos equivalentes do gráfico.
  const statusKeys =
    filters.status === "active"
      ? ["ativa"]
      : filters.status === "inactive"
        ? report.distributions.status.buckets.map((bucket) => bucket.key).filter((key) => key !== "ativa")
        : [filters.status];

  return (
    <div className="intel-workspace stack-lg">
      <div className="intel-filterbar tile">
        <MapFilters
          idPrefix="intel"
          filters={filters}
          states={states}
          hasBranchData={hasBranchData}
          resultCount={summary.total}
          totalCount={companies.length}
          active={filtersActive}
          onChange={setFilters}
          lookup={labels}
          unitLabel="empresas do universo"
        />
      </div>

      {!data.unlocked ? (
        <div className="notice info">
          Os indicadores usam só as empresas liberadas ({numberFormat.format(companies.length)} de amostra).
          {data.lockedCount > 0 ? ` Outras ${numberFormat.format(data.lockedCount)} entram na análise após a compra da lista.` : ""}{" "}
          <Link href={`/dashboard/search/${searchId}`}>Ver opções de compra</Link>
        </div>
      ) : null}

      <dl className="intel-kpis" aria-label="Indicadores do recorte">
        <Kpi
          label="Empresas analisadas"
          value={numberFormat.format(summary.total)}
          detail={filtersActive ? `de ${numberFormat.format(companies.length)} no universo` : "universo completo da busca"}
        />
        <Kpi
          label="Ativas"
          value={numberFormat.format(summary.active.count)}
          detail={`${formatShare(summary.active.share)} das ${numberFormat.format(summary.active.known)} com situação informada`}
        />
        <Kpi
          label={`Novas (${NEW_COMPANY_WINDOW_MONTHS} meses)`}
          value={numberFormat.format(summary.newCompanies.count)}
          detail={`${formatShare(summary.newCompanies.share)} das ${numberFormat.format(summary.newCompanies.known)} com data de abertura`}
          action={
            summary.newCompanies.count > 0 ? (
              <button type="button" className="button-ghost button-sm" onClick={() => toggleFacet("opened", "12m")} aria-pressed={filters.opened === "12m"}>
                {filters.opened === "12m" ? "Remover filtro" : "Filtrar"}
              </button>
            ) : null
          }
        />
        <Kpi
          label="Com telefone ou e-mail"
          value={numberFormat.format(summary.withContact.count)}
          detail={formatShare(summary.withContact.share)}
        />
        <Kpi
          label="Municípios"
          value={numberFormat.format(summary.distinct.municipalities)}
          detail={`${numberFormat.format(summary.distinct.states)} UF · ${numberFormat.format(summary.distinct.cnaes)} CNAEs`}
        />
        <Kpi
          label="Capital social mediano"
          value={summary.capital.median === null ? "—" : moneyFormat.format(summary.capital.median)}
          detail={`${numberFormat.format(summary.capital.known)} com capital informado`}
        />
      </dl>

      {palette ? (
        <div className="intel-grid">
          <RankingCard
            title="Empresas por município"
            facet="municipality"
            distribution={report.distributions.municipality}
            filters={filters}
            palette={palette}
            maxItems={12}
            note="Município do cadastro (Casa dos Dados), identificado na base IBGE."
            onToggle={toggleFacet}
            onClear={clearFacet}
          />
          <RankingCard
            title="Empresas por UF"
            facet="state"
            distribution={report.distributions.state}
            filters={filters}
            palette={palette}
            maxItems={27}
            labelWidth={60}
            onToggle={toggleFacet}
            onClear={clearFacet}
          />
          <RankingCard
            title="CNAE principal"
            facet="cnae"
            distribution={report.distributions.cnae}
            filters={filters}
            palette={palette}
            maxItems={10}
            labelWidth={220}
            onToggle={toggleFacet}
            onClear={clearFacet}
          />
          <RankingCard
            title="Porte"
            facet="size"
            distribution={report.distributions.size}
            filters={filters}
            palette={palette}
            maxItems={10}
            labelWidth={120}
            note="Porte como informado no cadastro (ME, EPP, Demais…)."
            onToggle={toggleFacet}
            onClear={clearFacet}
          />
          <RankingCard
            title="Situação cadastral"
            facet="status"
            distribution={report.distributions.status}
            filters={filters}
            palette={palette}
            maxItems={10}
            labelWidth={120}
            selectedKeys={statusKeys}
            onToggle={toggleFacet}
            onClear={clearFacet}
          />
          <ColumnCard
            title="Capital social"
            facet="capital"
            points={report.distributions.capital.buckets}
            total={report.distributions.capital.total}
            filters={filters}
            palette={palette}
            showValues
            rotateLabels
            note={
              summary.capital.known > 0
                ? `Faixas fixas. Média ${moneyFormat.format(summary.capital.mean ?? 0)} · soma ${moneyFormat.format(summary.capital.sum)} (${numberFormat.format(summary.capital.known)} empresas com capital informado).`
                : "Nenhuma empresa do recorte tem capital social informado."
            }
            onToggle={toggleFacet}
            onClear={clearFacet}
          />
          <ColumnCard
            title="Evolução de abertura (por ano)"
            facet="opened"
            points={report.opening.byYear}
            total={report.opening.known}
            filters={filters}
            palette={palette}
            extraHeader="Acumulado"
            note={`${numberFormat.format(report.opening.known)} empresas com data de abertura${
              report.opening.notInformed > 0 ? ` · ${numberFormat.format(report.opening.notInformed)} sem data` : ""
            }. Conta empresas da busca que ainda constam no cadastro, não o total aberto no ano.`}
            onToggle={toggleFacet}
            onClear={clearFacet}
            wide
          />
          <ColumnCard
            title="Aberturas nos últimos 24 meses"
            facet="opened"
            points={report.opening.byMonth}
            total={report.opening.byMonth.reduce((sum, point) => sum + point.count, 0)}
            filters={filters}
            palette={palette}
            note={`Por mês de abertura até ${formatMonthKey(report.referenceDate.slice(0, 7))} (data de referência ${formatDay(report.referenceDate)}).`}
            onToggle={toggleFacet}
            onClear={clearFacet}
            wide
          />
        </div>
      ) : null}

      <section className="intel-drill tile stack-sm" aria-labelledby="intel-drill-title">
        <div className="cluster-between">
          <div className="stack-xs">
            <span className="eyebrow">Empresas correspondentes</span>
            <h3 id="intel-drill-title" className="title-3">
              {numberFormat.format(summary.total)} {summary.total === 1 ? "empresa" : "empresas"} {filtersActive ? "com os filtros atuais" : "no universo"}
            </h3>
          </div>
          <div className="cluster">
            <Link href={listHref} className="button-secondary button-sm">
              Ver na lista
            </Link>
            <Link href={mapHref} className="button-secondary button-sm">
              Ver no mapa
            </Link>
          </div>
        </div>
        {matchedCompanies.length === 0 ? (
          <p className="footnote">Nenhuma empresa com esses filtros.</p>
        ) : (
          <ul className="intel-drill-list">
            {matchedCompanies.map((company) => (
              <li key={company.id}>
                <span className="intel-drill-name">{company.displayName}</span>
                <span className="footnote">
                  {[company.cityName && company.stateCode ? `${company.cityName}/${company.stateCode}` : company.cityName ?? company.stateCode, company.primaryCnaeDescription]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <Link href={withQuery(base, { view: "mapa", empresa: company.id }, filterQuery)} className="footnote">
                  Mapa
                </Link>
              </li>
            ))}
          </ul>
        )}
        {summary.total > matchedCompanies.length ? (
          <p className="footnote">
            Mostrando as primeiras {numberFormat.format(matchedCompanies.length)} pela ordem da busca. A lista completa abre em “Ver na lista”.
          </p>
        ) : null}
      </section>

      <p className="footnote">
        Fonte: cadastro das empresas retornadas pela Casa dos Dados nesta busca. Cálculos determinísticos (contagens, somas, média e
        mediana), sem estimativas nem IA. Data de referência: {formatDay(report.referenceDate)}.
      </p>
    </div>
  );
}

/** Base (com ou sem query) + parâmetros + filtros compartilhados. */
function withQuery(base: string, extra: Record<string, string | null>, filterQuery: string) {
  const [path, existing = ""] = base.split("?");
  const params = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  for (const [key, value] of new URLSearchParams(filterQuery)) params.set(key, value);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function formatDay(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function Kpi({ label, value, detail, action }: { label: string; value: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="intel-kpi">
      <dt className="stat-label">{label}</dt>
      <dd>
        <span className="stat-value numeric">{value}</span>
        {detail ? <span className="footnote">{detail}</span> : null}
        {action}
      </dd>
    </div>
  );
}

type FacetCardBase = {
  title: string;
  facet: FacetFilterKey;
  filters: CompanyTableFilters;
  palette: ChartPalette;
  note?: string;
  onToggle(key: FacetFilterKey, value: string): void;
  onClear(key: FacetFilterKey): void;
};

function facetValue(filters: CompanyTableFilters, facet: FacetFilterKey) {
  return filters[facet];
}

function RankingCard({
  title,
  facet,
  distribution,
  filters,
  palette,
  maxItems,
  labelWidth,
  note,
  selectedKeys,
  onToggle,
  onClear
}: FacetCardBase & {
  distribution: Distribution;
  maxItems: number;
  labelWidth?: number;
  /** Segmentos destacados (padrão: o valor do filtro desta dimensão). */
  selectedKeys?: string[];
}) {
  const current = facetValue(filters, facet);
  const hasSelection = current !== "all";
  const selectionKey = (selectedKeys ?? [current]).join("|");
  const model = useMemo(() => {
    const keys = new Set(selectionKey.split("|"));
    return rankingChartModel(distribution.buckets, {
      palette,
      isSelected: (key) => keys.has(key),
      hasSelection,
      maxItems,
      labelWidth,
      total: distribution.total
    });
  }, [distribution, palette, selectionKey, hasSelection, maxItems, labelWidth]);
  const selectedSet = new Set(selectionKey.split("|"));
  const selected = (key: string) => selectedSet.has(key);
  const rows: ChartTableRow[] = distribution.buckets.map((bucket: Bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    filterable: bucket.filterable,
    selected: hasSelection && selected(bucket.key)
  }));
  const onSelect = (key: string) => onToggle(facet, key);
  const informed = distribution.buckets.filter((bucket) => bucket.key !== NOT_INFORMED).length;

  return (
    <ChartCard
      title={title}
      note={note ?? `${numberFormat.format(informed)} segmento(s) · ${numberFormat.format(distribution.total)} empresas.`}
      filtered={hasSelection}
      onClear={() => onClear(facet)}
      rows={rows}
      total={distribution.total}
      onSelect={onSelect}
    >
      <EChart model={model} label={`${title}: gráfico de barras. Os mesmos dados estão na tabela.`} onSelect={onSelect} />
      {model.others ? (
        <p className="footnote">
          Outros {numberFormat.format(model.others.segments)} segmentos: {numberFormat.format(model.others.count)} empresas (lista completa na
          tabela).
        </p>
      ) : null}
    </ChartCard>
  );
}

function ColumnCard({
  title,
  facet,
  points,
  total,
  filters,
  palette,
  note,
  showValues,
  rotateLabels,
  extraHeader,
  wide,
  onToggle,
  onClear
}: FacetCardBase & {
  points: ReadonlyArray<Bucket | TimePoint>;
  total: number;
  showValues?: boolean;
  rotateLabels?: boolean;
  extraHeader?: string;
  wide?: boolean;
}) {
  const current = facetValue(filters, facet);
  const hasSelection = current !== "all";
  const model = useMemo(
    () =>
      columnChartModel(
        points.map((point) => ({ key: point.key, label: point.label, count: point.count, filterable: "filterable" in point ? point.filterable : true })),
        { palette, isSelected: (key) => key === current, hasSelection: hasSelection && points.some((point) => point.key === current), total, showValues, rotateLabels }
      ),
    [points, palette, current, hasSelection, total, showValues, rotateLabels]
  );
  const rows: ChartTableRow[] = points.map((point) => ({
    key: point.key,
    label: point.label,
    count: point.count,
    extra: "cumulative" in point ? numberFormat.format(point.cumulative) : undefined,
    filterable: "filterable" in point ? point.filterable : true,
    selected: point.key === current
  }));
  const onSelect = (key: string) => onToggle(facet, key);

  return (
    <ChartCard
      title={title}
      note={note}
      filtered={hasSelection}
      onClear={() => onClear(facet)}
      rows={rows}
      total={total}
      extraHeader={extraHeader}
      onSelect={onSelect}
      className={wide ? "intel-card-wide" : ""}
    >
      <EChart model={model} label={`${title}: gráfico de colunas. Os mesmos dados estão na tabela.`} onSelect={onSelect} />
    </ChartCard>
  );
}
