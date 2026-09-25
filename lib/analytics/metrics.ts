import {
  CAPITAL_BANDS,
  NEW_COMPANY_WINDOW_MONTHS,
  NOT_INFORMED,
  NOT_INFORMED_LABEL,
  computeFacetKeys,
  formatCnaeCode,
  formatMonthKey,
  monthsEndingAt,
  newCompanyWindowStart,
  validCapital,
  type FacetKeys
} from "@/lib/analytics/dimensions";
import {
  FACET_FILTER_KEYS,
  matchesBaseFilters,
  matchesFacet,
  type CompanyFilterSubject,
  type CompanyTableFilters,
  type FacetFilterKey
} from "@/lib/results/company-table-model";

/**
 * Motor de métricas da Inteligência de Mercado (Fase 3).
 *
 * - 100% determinístico: mesma entrada (empresas + filtros + data de referência) → mesma saída,
 *   inclusive a ORDEM dos segmentos (contagem desc → rótulo pt-BR → chave).
 * - Só usa campos que a Casa dos Dados devolveu para as empresas da busca. Não há estimativa,
 *   projeção, amostragem nem IA: cada número é uma contagem, soma, média ou mediana exata.
 * - "Não informado" é sempre um segmento explícito (nunca somado a outro, nunca descartado),
 *   então a soma dos segmentos de qualquer distribuição = total analisado. (Invariante testada.)
 *
 * Roda no navegador sobre o universo já carregado (≤ ANALYSIS_MAX_COMPANIES) — ver
 * docs/INTELIGENCIA_MERCADO.md para a decisão servidor × navegador × DuckDB-Wasm.
 */

/** Registro analítico = sujeito de filtro (mesmo da Lista e do Mapa) + rótulos para exibição. */
export type AnalyticsRecord = CompanyFilterSubject & {
  id: string;
  /** Rótulo do município ("Campinas/SP"); null se não identificado. */
  municipalityLabel: string | null;
  cnaeDescription: string | null;
};

export type Bucket = {
  key: string;
  label: string;
  count: number;
  /** count / total da distribuição (null quando total = 0). */
  share: number | null;
  /** Segmento clicável (drill-down) — "Não informado" de UF não é filtrável. */
  filterable: boolean;
};

export type TimePoint = { key: string; label: string; count: number; cumulative: number };

export type Ratio = { count: number; known: number; share: number | null };

export type CapitalSummary = {
  known: number;
  notInformed: number;
  /** Soma exata em centavos convertida para reais. */
  sum: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
};

export type IntelligenceSummary = {
  total: number;
  active: Ratio;
  newCompanies: Ratio & { windowMonths: number; since: string; referenceDate: string };
  withContact: Ratio;
  distinct: { states: number; municipalities: number; cnaes: number; sizes: number };
  capital: CapitalSummary;
};

export type Distribution = { buckets: Bucket[]; total: number };

export type OpeningSeries = {
  byYear: TimePoint[];
  /** Últimos 24 meses até o mês da referência (zeros preenchidos). */
  byMonth: TimePoint[];
  known: number;
  notInformed: number;
  /** Aberturas registradas com data POSTERIOR à referência (dado da fonte; não contam como novas). */
  afterReference: number;
};

export type IntelligenceReport = {
  referenceDate: string;
  /** Empresas que passam por TODOS os filtros (KPIs e lista de drill-down). */
  summary: IntelligenceSummary;
  /** Cada distribuição usa todos os filtros menos o da própria dimensão. */
  distributions: {
    status: Distribution;
    state: Distribution;
    municipality: Distribution;
    cnae: Distribution;
    size: Distribution;
    capital: Distribution;
  };
  opening: OpeningSeries;
  /** ids das empresas filtradas, na ordem do universo (posição da busca). */
  matchedIds: string[];
};

export const MONTH_SERIES_LENGTH = 24;

/** Chaves de dimensão do registro (pré-calculadas em toAnalyticsRecords; senão calcula). */
export function keysOf(record: AnalyticsRecord): FacetKeys {
  return record.keys ?? computeFacetKeys(record);
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function share(part: number, whole: number) {
  return whole > 0 ? part / whole : null;
}

/** Percentual para exibição com 1 casa (pt-BR); null → "—". Nunca inventa "0%". */
export function formatShare(value: number | null, digits = 1) {
  if (value === null) return "—";
  return `${(value * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

type Counter = Map<string, { label: string; count: number }>;

function bump(counter: Counter, key: string, label: () => string) {
  const entry = counter.get(key);
  if (entry) entry.count += 1;
  else counter.set(key, { label: label(), count: 1 });
}

/** Ordenação determinística: contagem desc → rótulo → chave; "não informado" sempre por último. */
function rankedBuckets(counter: Counter, total: number, filterableNa = true): Bucket[] {
  return Array.from(counter.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
      share: share(value.count, total),
      filterable: key !== NOT_INFORMED || filterableNa
    }))
    .sort((left, right) => {
      if (left.key === NOT_INFORMED && right.key !== NOT_INFORMED) return 1;
      if (right.key === NOT_INFORMED && left.key !== NOT_INFORMED) return -1;
      return right.count - left.count || collator.compare(left.label, right.label) || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    });
}

function statusLabel(status: string | null) {
  const text = (status ?? "").trim();
  if (!text) return NOT_INFORMED_LABEL;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/* ------------------------------------------------------------------ distribuições */

export function distributionByStatus(records: readonly AnalyticsRecord[]): Distribution {
  const counter: Counter = new Map();
  for (const record of records) bump(counter, keysOf(record).status, () => statusLabel(record.status));
  return { buckets: rankedBuckets(counter, records.length), total: records.length };
}

export function distributionByState(records: readonly AnalyticsRecord[]): Distribution {
  const counter: Counter = new Map();
  for (const record of records) {
    const key = keysOf(record).state;
    bump(counter, key, () => (key === NOT_INFORMED ? NOT_INFORMED_LABEL : key));
  }
  return { buckets: rankedBuckets(counter, records.length, false), total: records.length };
}

export function distributionByMunicipality(records: readonly AnalyticsRecord[]): Distribution {
  const counter: Counter = new Map();
  for (const record of records) {
    const key = keysOf(record).municipality;
    bump(counter, key, () => (key === NOT_INFORMED ? "Município não identificado" : record.municipalityLabel ?? key));
  }
  return { buckets: rankedBuckets(counter, records.length), total: records.length };
}

export function distributionByCnae(records: readonly AnalyticsRecord[]): Distribution {
  const counter: Counter = new Map();
  for (const record of records) {
    const key = keysOf(record).cnae;
    bump(counter, key, () =>
      key === NOT_INFORMED ? "CNAE não informado" : record.cnaeDescription ? `${formatCnaeCode(key)} · ${record.cnaeDescription}` : formatCnaeCode(key)
    );
  }
  return { buckets: rankedBuckets(counter, records.length), total: records.length };
}

export function distributionBySize(records: readonly AnalyticsRecord[]): Distribution {
  const counter: Counter = new Map();
  for (const record of records) {
    const key = keysOf(record).size;
    bump(counter, key, () => (key === NOT_INFORMED ? "Porte não informado" : (record.size ?? "").trim()));
  }
  return { buckets: rankedBuckets(counter, records.length), total: records.length };
}

/** Faixas de capital na ORDEM das faixas (não por contagem), com zeros; "não informado" no fim. */
export function distributionByCapital(records: readonly AnalyticsRecord[]): Distribution {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = keysOf(record).capital;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = records.length;
  const buckets: Bucket[] = CAPITAL_BANDS.map((band) => ({
    key: band.key,
    label: band.label,
    count: counts.get(band.key) ?? 0,
    share: share(counts.get(band.key) ?? 0, total),
    filterable: true
  }));
  const notInformed = counts.get(NOT_INFORMED) ?? 0;
  if (notInformed > 0)
    buckets.push({ key: NOT_INFORMED, label: "Capital não informado", count: notInformed, share: share(notInformed, total), filterable: true });
  return { buckets, total };
}

/* ------------------------------------------------------------------ séries temporais */

export function openingSeries(records: readonly AnalyticsRecord[], referenceDate: string): OpeningSeries {
  const years = new Map<string, number>();
  const months = new Map<string, number>();
  let known = 0;
  let afterReference = 0;
  for (const record of records) {
    const keys = keysOf(record);
    if (keys.day === null) continue;
    known += 1;
    years.set(keys.year, (years.get(keys.year) ?? 0) + 1);
    months.set(keys.month, (months.get(keys.month) ?? 0) + 1);
    if (keys.day > referenceDate) afterReference += 1;
  }

  const byYear: TimePoint[] = [];
  if (years.size > 0) {
    const sorted = Array.from(years.keys()).map(Number).sort((a, b) => a - b);
    let cumulative = 0;
    for (let year = sorted[0]; year <= sorted[sorted.length - 1]; year += 1) {
      const key = String(year).padStart(4, "0");
      const count = years.get(key) ?? 0;
      cumulative += count;
      byYear.push({ key, label: key, count, cumulative });
    }
  }

  let cumulative = 0;
  const byMonth = monthsEndingAt(referenceDate, MONTH_SERIES_LENGTH).map((key) => {
    const count = months.get(key) ?? 0;
    cumulative += count;
    return { key, label: formatMonthKey(key), count, cumulative };
  });

  return { byYear, byMonth, known, notInformed: records.length - known, afterReference };
}

/* ------------------------------------------------------------------ resumo */

/** Mediana exata (média dos dois centrais quando n é par). Entrada não precisa estar ordenada. */
export function median(values: readonly number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeCapital(records: readonly AnalyticsRecord[]): CapitalSummary {
  // Tudo em centavos inteiros: soma, média e mediana sem erro de ponto flutuante acumulado.
  const cents: number[] = [];
  let sumCents = 0;
  for (const record of records) {
    const capital = validCapital(record.shareCapital);
    if (capital === null) continue;
    const value = Math.round(capital * 100);
    cents.push(value);
    sumCents += value;
  }
  const known = cents.length;
  let min: number | null = null;
  let max: number | null = null;
  for (const value of cents) {
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
  }
  const medianCents = median(cents);
  return {
    known,
    notInformed: records.length - known,
    sum: sumCents / 100,
    mean: known > 0 ? Math.round(sumCents / known) / 100 : null,
    median: medianCents === null ? null : medianCents / 100,
    min: min === null ? null : min / 100,
    max: max === null ? null : max / 100
  };
}

export function summarizeRecords(records: readonly AnalyticsRecord[], referenceDate: string): IntelligenceSummary {
  const since = newCompanyWindowStart(referenceDate);
  let activeCount = 0;
  let statusKnown = 0;
  let newCount = 0;
  let openedKnown = 0;
  let withContact = 0;
  const states = new Set<string>();
  const municipalities = new Set<string>();
  const cnaes = new Set<string>();
  const sizes = new Set<string>();

  for (const record of records) {
    const keys = keysOf(record);
    if (keys.status !== NOT_INFORMED) {
      statusKnown += 1;
      if (keys.status === "ativa") activeCount += 1;
    }
    if (keys.day !== null) {
      openedKnown += 1;
      // Mesma regra de isNewCompany: [referência − 12 meses, referência], inclusivo.
      if (keys.day >= since && keys.day <= referenceDate) newCount += 1;
    }
    if (record.hasPhone || record.hasEmail) withContact += 1;
    if (keys.state !== NOT_INFORMED) states.add(keys.state);
    if (keys.municipality !== NOT_INFORMED) municipalities.add(keys.municipality);
    if (keys.cnae !== NOT_INFORMED) cnaes.add(keys.cnae);
    if (keys.size !== NOT_INFORMED) sizes.add(keys.size);
  }

  return {
    total: records.length,
    active: { count: activeCount, known: statusKnown, share: share(activeCount, statusKnown) },
    newCompanies: {
      count: newCount,
      known: openedKnown,
      share: share(newCount, openedKnown),
      windowMonths: NEW_COMPANY_WINDOW_MONTHS,
      since,
      referenceDate
    },
    withContact: { count: withContact, known: records.length, share: share(withContact, records.length) },
    distinct: { states: states.size, municipalities: municipalities.size, cnaes: cnaes.size, sizes: sizes.size },
    capital: summarizeCapital(records)
  };
}

/* ------------------------------------------------------------------ relatório com filtros */

/**
 * Relatório completo para os filtros atuais.
 * Custo: O(n × 8) avaliações de filtro + O(n) por distribuição — medido em
 * tests/inteligencia-mercado.test.mts (50.000 empresas em dezenas de ms).
 */
export function buildIntelligenceReport(
  records: readonly AnalyticsRecord[],
  filters: CompanyTableFilters,
  referenceDate: string
): IntelligenceReport {
  const facetCount = FACET_FILTER_KEYS.length;
  const matched: AnalyticsRecord[] = [];
  const perFacet: Record<FacetFilterKey, AnalyticsRecord[]> = {
    status: [],
    state: [],
    municipality: [],
    cnae: [],
    size: [],
    capital: [],
    opened: []
  };
  const passes = new Array<boolean>(facetCount);

  for (const record of records) {
    if (!matchesBaseFilters(record, filters)) continue;
    let failed = 0;
    let failedIndex = -1;
    for (let index = 0; index < facetCount; index += 1) {
      const ok = matchesFacet(record, FACET_FILTER_KEYS[index], filters, referenceDate);
      passes[index] = ok;
      if (!ok) {
        failed += 1;
        failedIndex = index;
        if (failed > 1) break;
      }
    }
    if (failed === 0) {
      matched.push(record);
      for (const key of FACET_FILTER_KEYS) perFacet[key].push(record);
    } else if (failed === 1) {
      // Falhou SÓ na própria faceta: entra no gráfico dela (para mostrar as alternativas).
      perFacet[FACET_FILTER_KEYS[failedIndex]].push(record);
    }
  }

  return {
    referenceDate,
    summary: summarizeRecords(matched, referenceDate),
    distributions: {
      status: distributionByStatus(perFacet.status),
      state: distributionByState(perFacet.state),
      municipality: distributionByMunicipality(perFacet.municipality),
      cnae: distributionByCnae(perFacet.cnae),
      size: distributionBySize(perFacet.size),
      capital: distributionByCapital(perFacet.capital)
    },
    opening: openingSeries(perFacet.opened, referenceDate),
    matchedIds: matched.map((record) => record.id)
  };
}

/** Soma dos segmentos (validação das agregações). */
export function bucketTotal(distribution: Distribution) {
  return distribution.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
}
