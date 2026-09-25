import { NOT_INFORMED, formatCnaeCode, openedFilterLabel } from "@/lib/analytics/dimensions";
import {
  distributionByCapital,
  distributionByCnae,
  distributionByMunicipality,
  distributionBySize,
  distributionByState,
  distributionByStatus,
  formatShare,
  keysOf,
  openingSeries,
  summarizeRecords,
  type AnalyticsRecord,
  type Distribution,
  type IntelligenceSummary
} from "@/lib/analytics/metrics";
import type { UniverseCounts } from "@/lib/analytics/universe";
import type { MapCompany } from "@/lib/map/types";
import { describeSpec, filterRecords, toTableFilters, type SpecLabelLookup } from "@/lib/ai/filters";
import {
  AI_DIMENSION_LABELS,
  type AiAction,
  type AiBlock,
  type AiCompanyRow,
  type AiCompanySort,
  type AiDimension,
  type AiFilterSpec,
  type AiMapLayer,
  type AiRankingRow,
  type AiToolCall,
  type AiUiCommand,
  type AiView
} from "@/lib/ai/types";

/**
 * MOTOR DETERMINÍSTICO das ferramentas do “Pergunte ao BuscaCNAE”.
 *
 * Cada ferramenta é uma função pura sobre o universo analisado da busca (os mesmos
 * registros de Empresas/Mapa/Inteligência) e reusa as funções de métricas da Fase 3.
 * Todos os números da resposta saem daqui; o texto da resposta é montado por template.
 */

export type ToolContext = {
  records: readonly AnalyticsRecord[];
  companiesById: ReadonlyMap<string, MapCompany>;
  referenceDate: string;
  universe: UniverseCounts | null;
  labels: SpecLabelLookup;
  /** Rótulos de município fora do universo (resolvidos pela base do IBGE). */
  extraMunicipalityLabels?: ReadonlyMap<string, string>;
  view: AiView;
};

export type ToolResult = {
  headline: string;
  blocks: AiBlock[];
  /** Empresas que passaram pelos filtros (base da resposta). */
  analyzed: number;
  uiCommand: AiUiCommand | null;
  actions: AiAction[];
  followUps: string[];
  /** Números calculados para a interpretação do modelo (verificação de números). */
  facts: Record<string, unknown>;
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const moneyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export function formatCount(value: number) {
  return numberFormat.format(value);
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

function labelsWithExtra(context: ToolContext): SpecLabelLookup {
  if (!context.extraMunicipalityLabels || context.extraMunicipalityLabels.size === 0) return context.labels;
  const municipality = new Map(context.labels.municipality);
  for (const [key, label] of context.extraMunicipalityLabels) if (!municipality.has(key)) municipality.set(key, label);
  return { ...context.labels, municipality };
}

export function describeFilters(spec: AiFilterSpec, context: ToolContext) {
  return describeSpec(spec, labelsWithExtra(context));
}

function recortePhrase(spec: AiFilterSpec, context: ToolContext) {
  const labels = describeFilters(spec, context);
  return labels.length > 0 ? ` (${labels.join(" · ")})` : "";
}

/** Recorte como frase separada, para títulos que já têm parênteses. */
function recorteSentence(spec: AiFilterSpec, context: ToolContext) {
  const labels = describeFilters(spec, context);
  return labels.length > 0 ? ` Recorte: ${labels.join(" · ")}.` : "";
}

/* ------------------------------------------------------------------ comandos de interface */

const VIEW_LABELS: Record<AiView, string> = { lista: "Empresas", mapa: "Mapa", inteligencia: "Inteligência" };

export function buildUiCommand(spec: AiFilterSpec, view: AiView, context: ToolContext, layer: AiMapLayer | null = null): AiUiCommand | null {
  const conversion = toTableFilters(spec);
  if (!conversion.representable) return null;
  const labels = describeFilters(spec, context);
  return { view, filters: conversion.filters, layer, label: [VIEW_LABELS[view], ...labels].join(" · ") };
}

/** Botões "Ver no mapa / na lista / na Inteligência" para o recorte (quando representável). */
function viewActions(spec: AiFilterSpec, context: ToolContext, skip: AiView | null = null): AiAction[] {
  const actions: AiAction[] = [];
  for (const view of ["lista", "mapa", "inteligencia"] as AiView[]) {
    if (view === skip) continue;
    const command = buildUiCommand(spec, view, context);
    if (command) actions.push({ label: view === "lista" ? "Ver na lista" : view === "mapa" ? "Ver no mapa" : "Ver na Inteligência", command });
  }
  return actions;
}

/**
 * Recorte com vários valores por dimensão: a interface aplica um valor por filtro, então
 * oferecemos um botão por combinação (produto cartesiano, no máximo 8) — nunca um recorte
 * diferente do analisado.
 */
function splitActions(spec: AiFilterSpec, view: AiView, context: ToolContext, layer: AiMapLayer | null = null): AiAction[] {
  const keys = (["municipalities", "states", "cnaes", "sizes", "capital"] as const).filter((key) => (spec[key]?.length ?? 0) > 1);
  if (keys.length === 0) return [];
  let combos: AiFilterSpec[] = [{}];
  for (const key of keys) {
    const next: AiFilterSpec[] = [];
    for (const combo of combos) for (const value of spec[key] ?? []) next.push({ ...combo, [key]: [value] });
    combos = next;
    if (combos.length > 8) break;
  }
  if (combos.length > 8) return [];
  const actions: AiAction[] = [];
  for (const combo of combos) {
    const command = buildUiCommand({ ...spec, ...combo }, view, context, layer);
    if (!command) continue;
    const label = describeFilters(combo, context)
      .map((item) => item.replace(/^[^:]+:\s*/, ""))
      .join(" · ");
    actions.push({ label: `${VIEW_LABELS[view]}: ${label}`, command });
  }
  return actions;
}

/* ------------------------------------------------------------------ distribuições */

export function distributionFor(records: readonly AnalyticsRecord[], dimension: AiDimension, referenceDate: string): Distribution {
  switch (dimension) {
    case "municipality":
      return distributionByMunicipality(records);
    case "state":
      return distributionByState(records);
    case "cnae":
      return distributionByCnae(records);
    case "size":
      return distributionBySize(records);
    case "status":
      return distributionByStatus(records);
    case "capital":
      return distributionByCapital(records);
    case "openedYear": {
      const series = openingSeries(records, referenceDate);
      const buckets = series.byYear.map((point) => ({ key: point.key, label: point.label, count: point.count, share: records.length > 0 ? point.count / records.length : null, filterable: true }));
      if (series.notInformed > 0)
        buckets.push({ key: NOT_INFORMED, label: "Sem data de abertura", count: series.notInformed, share: series.notInformed / records.length, filterable: true });
      return { buckets, total: records.length };
    }
    case "openedMonth": {
      const series = openingSeries(records, referenceDate);
      const inWindow = series.byMonth.reduce((sum, point) => sum + point.count, 0);
      const buckets = series.byMonth.map((point) => ({ key: point.key, label: point.label, count: point.count, share: records.length > 0 ? point.count / records.length : null, filterable: true }));
      const outside = records.length - inWindow;
      if (outside > 0) buckets.push({ key: "__fora__", label: "Fora dos últimos 24 meses ou sem data", count: outside, share: outside / records.length, filterable: false });
      return { buckets, total: records.length };
    }
  }
}

const ORDERED_DIMENSIONS = new Set<AiDimension>(["capital", "openedYear", "openedMonth"]);

function rankingRows(distribution: Distribution, dimension: AiDimension, top: number) {
  const ordered = ORDERED_DIMENSIONS.has(dimension);
  const informed = distribution.buckets.filter((bucket) => bucket.key !== NOT_INFORMED && bucket.key !== "__fora__");
  const tail = distribution.buckets.filter((bucket) => bucket.key === NOT_INFORMED || bucket.key === "__fora__");
  // Séries ordenadas (anos, meses, faixas) mostram tudo; rankings mostram o top N.
  const head = ordered ? informed : informed.slice(0, top);
  const rest = ordered ? [] : informed.slice(top);
  const rows: AiRankingRow[] = [...head, ...tail].map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    share: bucket.share,
    filterable: bucket.filterable && bucket.key !== "__fora__"
  }));
  const others = rest.length > 0 ? { segments: rest.length, count: rest.reduce((sum, bucket) => sum + bucket.count, 0) } : null;
  return { rows, others };
}

/** Spec de drill-down para um segmento (usado nos botões de linha). */
export function segmentSpec(spec: AiFilterSpec, dimension: AiDimension, key: string): AiFilterSpec | null {
  switch (dimension) {
    case "municipality":
      return { ...spec, municipalities: [key] };
    case "state":
      return key === NOT_INFORMED ? null : { ...spec, states: [key] };
    case "cnae":
      return { ...spec, cnaes: [key] };
    case "size":
      return { ...spec, sizes: [key] };
    case "status":
      return { ...spec, status: key };
    case "capital":
      return { ...spec, capital: [key] };
    case "openedYear":
    case "openedMonth":
      return key.startsWith("__") ? null : { ...spec, opened: key };
  }
}

/* ------------------------------------------------------------------ lista de empresas */

function sortRecords(records: AnalyticsRecord[], sort: AiCompanySort, companies: ReadonlyMap<string, MapCompany>) {
  if (sort === "position") return records;
  const name = (record: AnalyticsRecord) => companies.get(record.id)?.displayName ?? record.cnpj;
  const sorted = [...records];
  sorted.sort((left, right) => {
    switch (sort) {
      case "capital_desc":
        return (right.shareCapital ?? -1) - (left.shareCapital ?? -1) || collator.compare(name(left), name(right));
      case "capital_asc": {
        const a = left.shareCapital ?? Number.POSITIVE_INFINITY;
        const b = right.shareCapital ?? Number.POSITIVE_INFINITY;
        return a - b || collator.compare(name(left), name(right));
      }
      case "opened_desc":
        return (keysOf(right).day ?? "").localeCompare(keysOf(left).day ?? "") || collator.compare(name(left), name(right));
      case "opened_asc": {
        const a = keysOf(left).day ?? "9999";
        const b = keysOf(right).day ?? "9999";
        return a.localeCompare(b) || collator.compare(name(left), name(right));
      }
      case "name":
        return collator.compare(name(left), name(right));
    }
    return 0;
  });
  return sorted;
}

const SORT_LABELS: Record<AiCompanySort, string> = {
  position: "ordem da busca",
  capital_desc: "maior capital social",
  capital_asc: "menor capital social",
  opened_desc: "abertura mais recente",
  opened_asc: "abertura mais antiga",
  name: "ordem alfabética"
};

function companyRow(record: AnalyticsRecord, company: MapCompany | undefined): AiCompanyRow {
  return {
    id: record.id,
    name: company?.displayName ?? record.cnpj,
    cnpj: record.cnpj,
    city: company?.cityName ?? null,
    state: company?.stateCode ?? null,
    cnae: record.cnae ? `${formatCnaeCode(record.cnae)}${record.cnaeDescription ? ` · ${record.cnaeDescription}` : ""}` : null,
    status: record.status,
    size: record.size,
    openedAt: keysOf(record).day,
    capital: typeof record.shareCapital === "number" && Number.isFinite(record.shareCapital) && record.shareCapital >= 0 ? record.shareCapital : null
  };
}

/* ------------------------------------------------------------------ KPIs */

function summaryKpis(summary: IntelligenceSummary) {
  return [
    { label: "Empresas", value: formatCount(summary.total), provenance: "calculo" as const, detail: "que passam pelos filtros" },
    {
      label: "Ativas",
      value: formatCount(summary.active.count),
      detail: `${formatShare(summary.active.share)} das ${formatCount(summary.active.known)} com situação informada`,
      provenance: "calculo" as const
    },
    {
      label: `Novas (${summary.newCompanies.windowMonths} meses)`,
      value: formatCount(summary.newCompanies.count),
      detail: `${formatShare(summary.newCompanies.share)} das ${formatCount(summary.newCompanies.known)} com data de abertura`,
      provenance: "calculo" as const
    },
    {
      label: "Com telefone ou e-mail",
      value: formatCount(summary.withContact.count),
      detail: formatShare(summary.withContact.share),
      provenance: "calculo" as const
    },
    {
      label: "Municípios",
      value: formatCount(summary.distinct.municipalities),
      detail: `${plural(summary.distinct.states, "UF", "UFs")} · ${plural(summary.distinct.cnaes, "CNAE", "CNAEs")}`,
      provenance: "calculo" as const
    },
    {
      label: "Capital social mediano",
      value: summary.capital.median === null ? "—" : moneyFormat.format(summary.capital.median),
      detail: `${formatCount(summary.capital.known)} com capital informado`,
      provenance: "calculo" as const
    }
  ];
}

function summaryFacts(summary: IntelligenceSummary) {
  return {
    total: summary.total,
    ativas: summary.active.count,
    ativasPercentual: formatShare(summary.active.share),
    comSituacaoInformada: summary.active.known,
    janelaNovasMeses: summary.newCompanies.windowMonths,
    novasNaJanela: summary.newCompanies.count,
    novasPercentual: formatShare(summary.newCompanies.share),
    comContato: summary.withContact.count,
    comContatoPercentual: formatShare(summary.withContact.share),
    municipios: summary.distinct.municipalities,
    ufs: summary.distinct.states,
    cnaes: summary.distinct.cnaes,
    capitalMediano: summary.capital.median === null ? null : moneyFormat.format(summary.capital.median)
  };
}

/* ------------------------------------------------------------------ execução */

export function executeTool(call: AiToolCall, context: ToolContext): ToolResult {
  const { referenceDate } = context;
  const universeSize = context.records.length;

  switch (call.tool) {
    case "searchCompanies":
    case "getCompaniesByCnae":
    case "getCompaniesByCity": {
      const matched = filterRecords(context.records, call.filters, referenceDate);
      const sorted = sortRecords(matched, call.sort, context.companiesById);
      const rows = sorted.slice(0, call.limit).map((record) => companyRow(record, context.companiesById.get(record.id)));
      const recorte = recortePhrase(call.filters, context);
      const headline =
        matched.length === 0
          ? `Nenhuma das ${formatCount(universeSize)} empresas desta busca atende ao recorte${recorte}.`
          : `${plural(matched.length, "empresa atende", "empresas atendem")} ao recorte${recorte}, de ${formatCount(universeSize)} no universo analisado.`;
      const blocks: AiBlock[] = [{ type: "kpis", items: [{ label: "Empresas encontradas", value: formatCount(matched.length), detail: `de ${formatCount(universeSize)} no universo`, provenance: "calculo" }] }];
      if (rows.length > 0) blocks.push({ type: "companies", total: matched.length, rows, sortLabel: SORT_LABELS[call.sort], provenance: "dado" });
      const actions = viewActions(call.filters, context);
      if (actions.length === 0) actions.push(...splitActions(call.filters, "lista", context));
      return {
        headline,
        blocks,
        analyzed: matched.length,
        uiCommand: null,
        actions,
        followUps: matched.length > 0 ? ["Quais municípios têm mais?", "Mostre no mapa", "Mostre em gráfico por porte"] : ["Quais municípios têm mais empresas?"],
        facts: { encontradas: matched.length, universo: universeSize, exibidas: rows.length }
      };
    }

    case "aggregateCompanies":
    case "createChart": {
      const matched = filterRecords(context.records, call.filters, referenceDate);
      const distribution = distributionFor(matched, call.groupBy, referenceDate);
      const { rows, others } = rankingRows(distribution, call.groupBy, call.top);
      const dimensionLabel = AI_DIMENSION_LABELS[call.groupBy];
      const leader = rows.find((row) => row.key !== NOT_INFORMED && !row.key.startsWith("__") && row.count > 0);
      const ordered = ORDERED_DIMENSIONS.has(call.groupBy);
      const recorte = recortePhrase(call.filters, context);
      let headline: string;
      if (matched.length === 0) headline = `Nenhuma empresa desta busca atende ao recorte${recorte}; não há o que agrupar por ${dimensionLabel}.`;
      else if (ordered) {
        const peak = [...rows].filter((row) => row.filterable).sort((left, right) => right.count - left.count)[0];
        headline = `${plural(matched.length, "empresa", "empresas")} por ${dimensionLabel}.${peak ? ` Maior valor: ${peak.label}, com ${plural(peak.count, "empresa", "empresas")} (${formatShare(peak.share)}).` : ""}${recorteSentence(call.filters, context)}`;
      } else {
        headline = leader
          ? `${leader.label} lidera com ${plural(leader.count, "empresa", "empresas")} (${formatShare(leader.share)} de ${formatCount(matched.length)}).${recorteSentence(call.filters, context)}`
          : `${plural(matched.length, "empresa", "empresas")}${recorte}, todas sem ${dimensionLabel} informado.`;
      }
      const chart: "bar" | "column" | null = call.tool === "createChart" ? (ordered ? "column" : "bar") : null;
      const title = `Empresas por ${dimensionLabel}`;
      const actions = viewActions(call.filters, context);
      return {
        headline,
        blocks: [{ type: "ranking", dimension: call.groupBy, title, rows, total: distribution.total, others, chart, provenance: "calculo" }],
        analyzed: matched.length,
        uiCommand: null,
        actions,
        followUps:
          call.tool === "createChart"
            ? ["Mostre no mapa", "Liste as empresas"]
            : ["Mostre em gráfico", ...(call.groupBy === "municipality" && rows.length >= 2 && !rows[1].key.startsWith("_") && rows[1].key !== NOT_INFORMED ? [`Compare ${rows[0].label} e ${rows[1].label}`] : []), "Mostre no mapa"],
        facts: {
          total: matched.length,
          dimensao: dimensionLabel,
          segmentos: rows.map((row) => ({ rotulo: row.label, empresas: row.count, percentual: formatShare(row.share) })),
          outros: others
        }
      };
    }

    case "compareRegions": {
      const base = filterRecords(context.records, call.filters, referenceDate);
      const labels = labelsWithExtra(context);
      const columns = call.regions.map((region) => ({
        key: region.key,
        kind: region.kind,
        label: region.kind === "state" ? region.key : labels.municipality.get(region.key) ?? region.key
      }));
      const perRegion = call.regions.map((region) =>
        base.filter((record) => (region.kind === "state" ? keysOf(record).state === region.key : keysOf(record).municipality === region.key))
      );
      const summaries = perRegion.map((records) => summarizeRecords(records, referenceDate));
      const topCnae = perRegion.map((records) => distributionByCnae(records).buckets.find((bucket) => bucket.key !== NOT_INFORMED) ?? null);
      const topSize = perRegion.map((records) => distributionBySize(records).buckets.find((bucket) => bucket.key !== NOT_INFORMED) ?? null);
      const money = (value: number | null) => (value === null ? "—" : moneyFormat.format(value));
      const rows = [
        { metric: "Empresas", values: summaries.map((summary) => formatCount(summary.total)), provenance: "calculo" as const },
        {
          metric: "Participação no recorte",
          values: summaries.map((summary) => formatShare(base.length > 0 ? summary.total / base.length : null)),
          provenance: "calculo" as const,
          note: `sobre ${formatCount(base.length)} empresas do recorte`
        },
        { metric: "Ativas", values: summaries.map((summary) => `${formatCount(summary.active.count)} (${formatShare(summary.active.share)})`), provenance: "calculo" as const },
        {
          metric: `Novas (${summaries[0]?.newCompanies.windowMonths ?? 12} meses)`,
          values: summaries.map((summary) => `${formatCount(summary.newCompanies.count)} (${formatShare(summary.newCompanies.share)})`),
          provenance: "calculo" as const
        },
        {
          metric: "Com telefone ou e-mail",
          values: summaries.map((summary) => `${formatCount(summary.withContact.count)} (${formatShare(summary.withContact.share)})`),
          provenance: "calculo" as const
        },
        { metric: "Capital social mediano", values: summaries.map((summary) => money(summary.capital.median)), provenance: "calculo" as const },
        { metric: "CNAE mais frequente", values: topCnae.map((bucket) => (bucket ? `${bucket.label} (${formatCount(bucket.count)})` : "—")), provenance: "calculo" as const },
        { metric: "Porte mais frequente", values: topSize.map((bucket) => (bucket ? `${bucket.label} (${formatCount(bucket.count)})` : "—")), provenance: "calculo" as const }
      ];
      const ranked = columns.map((column, index) => ({ column, total: summaries[index].total })).sort((left, right) => right.total - left.total);
      let headline: string;
      if (ranked.every((item) => item.total === 0)) headline = `Nenhuma das regiões comparadas tem empresas nesta busca${recortePhrase(call.filters, context)}.`;
      else if (ranked.length === 2) {
        const [first, second] = ranked;
        const difference = first.total - second.total;
        headline =
          difference === 0
            ? `${first.column.label} e ${second.column.label} empatam com ${plural(first.total, "empresa", "empresas")} cada.${recorteSentence(call.filters, context)}`
            : `${first.column.label} tem ${plural(first.total, "empresa", "empresas")} e ${second.column.label}, ${formatCount(second.total)} — diferença de ${formatCount(difference)}${second.total > 0 ? ` (${(first.total / second.total).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes)` : ""}.${recorteSentence(call.filters, context)}`;
      } else {
        headline = `${ranked[0].column.label} lidera com ${plural(ranked[0].total, "empresa", "empresas")}; ${ranked
          .slice(1)
          .map((item) => `${item.column.label}: ${formatCount(item.total)}`)
          .join("; ")}.${recorteSentence(call.filters, context)}`;
      }
      const regionKind = call.regions.every((region) => region.kind === "municipality") ? "municipalities" : call.regions.every((region) => region.kind === "state") ? "states" : null;
      const union: AiFilterSpec = regionKind ? { ...call.filters, [regionKind]: call.regions.map((region) => region.key) } : call.filters;
      const actions: AiAction[] = [];
      for (const view of ["mapa", "lista"] as AiView[]) {
        for (const region of call.regions) {
          const spec = region.kind === "state" ? { ...call.filters, states: [region.key] } : { ...call.filters, municipalities: [region.key] };
          const command = buildUiCommand(spec, view, context, view === "mapa" ? "companies" : null);
          const label = columns.find((column) => column.key === region.key)?.label ?? region.key;
          if (command) actions.push({ label: `${view === "mapa" ? "Mapa" : "Lista"}: ${label}`, command });
        }
      }
      return {
        headline,
        blocks: [{ type: "comparison", columns, rows }],
        analyzed: perRegion.reduce((sum, records) => sum + records.length, 0),
        uiCommand: null,
        actions: actions.slice(0, 8),
        followUps: ["Mostre em gráfico", "Compare somente as ativas", "Mostre no mapa"],
        facts: {
          recorte: base.length,
          regioes: columns.map((column, index) => ({ regiao: column.label, ...summaryFacts(summaries[index]) })),
          union: describeFilters(union, context)
        }
      };
    }

    case "summarizeCompanies": {
      const matched = filterRecords(context.records, call.filters, referenceDate);
      const summary = summarizeRecords(matched, referenceDate);
      const recorte = recortePhrase(call.filters, context);
      return {
        headline:
          matched.length === 0
            ? `Nenhuma empresa desta busca atende ao recorte${recorte}.`
            : `${plural(matched.length, "empresa", "empresas")}${recorte}: ${formatCount(summary.active.count)} ativas (${formatShare(summary.active.share)}), ${formatCount(summary.newCompanies.count)} abertas nos últimos 12 meses, em ${plural(summary.distinct.municipalities, "município", "municípios")}.`,
        blocks: [{ type: "kpis", items: summaryKpis(summary) }],
        analyzed: matched.length,
        uiCommand: null,
        actions: viewActions(call.filters, context),
        followUps: ["Quais municípios têm mais?", "Por porte", "Evolução de abertura por ano"],
        facts: summaryFacts(summary)
      };
    }

    case "showOnMap":
    case "showInList":
    case "showIntelligence": {
      const view: AiView = call.tool === "showOnMap" ? "mapa" : call.tool === "showInList" ? "lista" : "inteligencia";
      const layer = call.tool === "showOnMap" ? call.layer : null;
      const matched = filterRecords(context.records, call.filters, referenceDate);
      const command = buildUiCommand(call.filters, view, context, layer);
      const recorte = recortePhrase(call.filters, context);
      if (!command) {
        const split = splitActions(call.filters, view, context, layer);
        return {
          headline: `${plural(matched.length, "empresa atende", "empresas atendem")} ao recorte${recorte}. A aba ${VIEW_LABELS[view]} aplica um valor por filtro; escolha qual abrir:`,
          blocks: [],
          analyzed: matched.length,
          uiCommand: null,
          actions: split,
          followUps: [],
          facts: { encontradas: matched.length }
        };
      }
      const where = view === "mapa" ? "no mapa" : view === "lista" ? "na lista (aba Empresas)" : "na Inteligência";
      return {
        headline:
          matched.length === 0
            ? `Nenhuma empresa atende ao recorte${recorte}; abri ${where} mesmo assim, com os filtros aplicados.`
            : `Abrindo ${plural(matched.length, "empresa", "empresas")} ${where}${recorte}.`,
        blocks: [],
        analyzed: matched.length,
        uiCommand: command,
        actions: viewActions(call.filters, context, view),
        followUps: view === "mapa" ? ["Mostre a concentração no mapa", "Quais municípios têm mais?"] : ["Mostre no mapa", "Quais municípios têm mais?"],
        facts: { encontradas: matched.length }
      };
    }
  }
}

/** Período legível do filtro de abertura (transparência). */
export function periodLabel(spec: AiFilterSpec) {
  return spec.opened ? openedFilterLabel(spec.opened) : null;
}
