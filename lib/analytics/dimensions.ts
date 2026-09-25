/**
 * Dimensões analíticas do BuscaCNAE (Fase 3 — Inteligência de Mercado).
 *
 * Funções PURAS e determinísticas que convertem um campo do modelo normalizado
 * (Company → CompanyListItem / MapCompany) em uma CHAVE de agrupamento estável.
 * Lista, Mapa e Inteligência usam exatamente estas funções — para agrupar (gráficos)
 * e para filtrar (drill-down) — então um segmento clicado num gráfico sempre filtra
 * as mesmas empresas que ele contou.
 *
 * Regras:
 * - nenhum valor é inventado: campo ausente/inválido vira a chave "na" (não informado);
 * - datas só no formato ISO (AAAA-MM-DD…) que o modelo já normaliza;
 * - "novas empresas" dependem de uma DATA DE REFERÊNCIA explícita (AAAA-MM-DD), calculada
 *   uma vez no servidor e compartilhada pelas três visões (nada de `new Date()` espalhado).
 *
 * Este arquivo não importa nada de Node, React ou do banco (roda no servidor e no navegador).
 */

/** Chave de "não informado" em todas as dimensões. */
export const NOT_INFORMED = "na";
export const NOT_INFORMED_LABEL = "Não informado";

/** Janela de "novas empresas" (meses). */
export const NEW_COMPANY_WINDOW_MONTHS = 12;

/** Fuso usado para a data de referência (o produto opera no Brasil). */
export const REFERENCE_TIME_ZONE = "America/Sao_Paulo";

/* ------------------------------------------------------------------ texto */

export function foldText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string) {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------ situação */

export function isActiveStatus(status: string | null | undefined) {
  return foldText(status) === "ativa";
}

/** "ATIVA" → "ativa", "Baixada" → "baixada", vazio → "na". */
export function statusKey(status: string | null | undefined) {
  const key = slug(status ?? "");
  return key || NOT_INFORMED;
}

/* ------------------------------------------------------------------ porte */

/** "ME" → "me", "Micro Empresa" → "micro-empresa", vazio → "na". */
export function sizeKey(size: string | null | undefined) {
  const key = slug(size ?? "");
  return key || NOT_INFORMED;
}

/* ------------------------------------------------------------------ CNAE */

/** CNAE principal com 7 dígitos; qualquer outra coisa → "na". */
export function cnaeKey(code: string | null | undefined) {
  const digits = (code ?? "").replace(/\D/g, "");
  return digits.length === 7 ? digits : NOT_INFORMED;
}

export function formatCnaeCode(code: string) {
  const digits = code.replace(/\D/g, "");
  return digits.length === 7 ? `${digits.slice(0, 4)}-${digits.slice(4, 5)}/${digits.slice(5)}` : code;
}

/* ------------------------------------------------------------------ município */

/** Código IBGE (7 dígitos) já resolvido pela base local; ausente → "na". */
export function municipalityDimensionKey(ibge: string | null | undefined) {
  return ibge && /^\d{7}$/.test(ibge) ? ibge : NOT_INFORMED;
}

/* ------------------------------------------------------------------ UF */

export function stateKey(state: string | null | undefined) {
  const value = (state ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : NOT_INFORMED;
}

/* ------------------------------------------------------------------ capital social */

export type CapitalBand = {
  key: string;
  label: string;
  /** Limite inferior EXCLUSIVO (null = sem limite); "zero" usa min=max=0. */
  min: number | null;
  /** Limite superior INCLUSIVO (null = sem limite). */
  max: number | null;
};

/**
 * Faixas fixas de capital social (R$). Fixas de propósito: comparáveis entre buscas
 * e sem depender da distribuição dos dados. Intervalos (min, max].
 */
export const CAPITAL_BANDS: readonly CapitalBand[] = [
  { key: "zero", label: "R$ 0", min: 0, max: 0 },
  { key: "ate-10k", label: "Até R$ 10 mil", min: 0, max: 10_000 },
  { key: "10k-50k", label: "R$ 10–50 mil", min: 10_000, max: 50_000 },
  { key: "50k-100k", label: "R$ 50–100 mil", min: 50_000, max: 100_000 },
  { key: "100k-500k", label: "R$ 100–500 mil", min: 100_000, max: 500_000 },
  { key: "500k-1m", label: "R$ 500 mil–1 mi", min: 500_000, max: 1_000_000 },
  { key: "1m-10m", label: "R$ 1–10 mi", min: 1_000_000, max: 10_000_000 },
  { key: "acima-10m", label: "Acima de R$ 10 mi", min: 10_000_000, max: null }
];

export const CAPITAL_BAND_KEYS = new Set(CAPITAL_BANDS.map((band) => band.key));

/** Capital válido = número finito ≥ 0. Negativo, NaN ou ausente → null (não informado). */
export function validCapital(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function capitalBandKey(value: number | null | undefined) {
  const capital = validCapital(value);
  if (capital === null) return NOT_INFORMED;
  if (capital === 0) return "zero";
  for (const band of CAPITAL_BANDS) {
    if (band.key === "zero") continue;
    if ((band.min === null || capital > band.min) && (band.max === null || capital <= band.max)) return band.key;
  }
  return NOT_INFORMED;
}

/* ------------------------------------------------------------------ datas */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "AAAA-MM-DD" válido (mês 1–12, dia existente) ou null. */
export function parseIsoDay(value: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1800 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number, size = 2) {
  return String(value).padStart(size, "0");
}

export function formatIsoDay(parts: { year: number; month: number; day: number }) {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Ano de abertura ("2021") ou "na". */
export function openedYearKey(openedAt: string | null | undefined) {
  const parts = parseIsoDay(openedAt);
  return parts ? pad(parts.year, 4) : NOT_INFORMED;
}

/** Mês de abertura ("2021-07") ou "na". */
export function openedMonthKey(openedAt: string | null | undefined) {
  const parts = parseIsoDay(openedAt);
  return parts ? `${pad(parts.year, 4)}-${pad(parts.month)}` : NOT_INFORMED;
}

/**
 * Data de referência dos cálculos (AAAA-MM-DD) no fuso de São Paulo.
 * Calculada UMA vez no servidor por resposta e enviada às visões.
 */
let referenceFormatter: Intl.DateTimeFormat | null = null;

export function analysisReferenceDate(now: Date = new Date()) {
  referenceFormatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: REFERENCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = referenceFormatter.formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Subtrai meses de uma data ISO com ajuste de fim de mês (29/02 − 12 meses = 28/02). */
export function subtractMonthsIso(reference: string, months: number) {
  const parts = parseIsoDay(reference);
  if (!parts) throw new Error(`Data de referência inválida: ${reference}`);
  const totalMonths = parts.year * 12 + (parts.month - 1) - months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return formatIsoDay({ year, month, day: Math.min(parts.day, daysInMonth(year, month)) });
}

/** Início (inclusivo) da janela de novas empresas para uma data de referência. */
export function newCompanyWindowStart(referenceDate: string) {
  return subtractMonthsIso(referenceDate, NEW_COMPANY_WINDOW_MONTHS);
}

/**
 * Nova empresa = data de abertura conhecida e dentro de [referência − 12 meses, referência],
 * ambos inclusivos. Datas futuras (após a referência) NÃO contam como novas.
 */
export function isNewCompany(openedAt: string | null | undefined, referenceDate: string, windowStart = newCompanyWindowStart(referenceDate)) {
  const parts = parseIsoDay(openedAt);
  if (!parts) return false;
  const day = formatIsoDay(parts);
  return day >= windowStart && day <= referenceDate;
}

/** Os N meses terminando no mês da referência, em ordem cronológica ("AAAA-MM"). */
export function monthsEndingAt(referenceDate: string, count: number) {
  const parts = parseIsoDay(referenceDate);
  if (!parts) throw new Error(`Data de referência inválida: ${referenceDate}`);
  const months: string[] = [];
  const end = parts.year * 12 + (parts.month - 1);
  for (let index = count - 1; index >= 0; index -= 1) {
    const total = end - index;
    months.push(`${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`);
  }
  return months;
}

/* ------------------------------------------------------------------ filtro de abertura */

/** Maior janela aceita em "Nm" (50 anos). */
export const MAX_OPENED_WINDOW_MONTHS = 600;

const WINDOW_FILTER = /^(\d{1,3})m$/;
const YEAR_RANGE_FILTER = /^(\d{4}):(\d{4})$/;

/** "24m" → 24; qualquer outra coisa → null. "12m" = novas empresas. */
export function openedWindowMonths(value: string) {
  const match = WINDOW_FILTER.exec(value);
  if (!match) return null;
  const months = Number(match[1]);
  return months >= 1 && months <= MAX_OPENED_WINDOW_MONTHS ? months : null;
}

/** "2019:2021" → { from: "2019", to: "2021" } (inclusivo); from > to → null. */
export function openedYearRange(value: string) {
  const match = YEAR_RANGE_FILTER.exec(value);
  if (!match || match[1] > match[2] || Number(match[1]) < 1800) return null;
  return { from: match[1], to: match[2] };
}

/**
 * Valores aceitos no filtro de abertura (?abertura=):
 * - "12m" (novas empresas) ou, em geral, "Nm" = abertas nos últimos N meses (1–600),
 *   janela [referência − N meses, referência] inclusiva (Fase 4: "últimos 2 anos" = "24m");
 * - "AAAA" (ano), "AAAA-MM" (mês), "AAAA:AAAA" (anos, inclusivo) ou "na" (sem data).
 */
export function isOpenedFilterValue(value: string) {
  return (
    value === NOT_INFORMED ||
    openedWindowMonths(value) !== null ||
    openedYearRange(value) !== null ||
    /^\d{4}$/.test(value) ||
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
  );
}

const windowCache = new Map<string, string>();

/** Início (inclusivo) de uma janela de N meses, com cache por referência (evita recalcular por empresa). */
export function cachedWindowStart(referenceDate: string, months = NEW_COMPANY_WINDOW_MONTHS) {
  const cacheKey = `${referenceDate}|${months}`;
  let start = windowCache.get(cacheKey);
  if (start === undefined) {
    if (windowCache.size > 64) windowCache.clear();
    start = subtractMonthsIso(referenceDate, months);
    windowCache.set(cacheKey, start);
  }
  return start;
}

function matchesOpenedDay(day: string | null, year: string, month: string, filter: string, referenceDate: string) {
  const months = openedWindowMonths(filter);
  if (months !== null) return day !== null && day >= cachedWindowStart(referenceDate, months) && day <= referenceDate;
  if (filter === NOT_INFORMED) return year === NOT_INFORMED;
  const range = openedYearRange(filter);
  if (range) return year !== NOT_INFORMED && year >= range.from && year <= range.to;
  if (filter.length === 4) return year === filter;
  return month === filter;
}

export function matchesOpenedFilter(openedAt: string | null | undefined, filter: string, referenceDate: string) {
  const parts = parseIsoDay(openedAt);
  return matchesOpenedDay(
    parts ? formatIsoDay(parts) : null,
    parts ? pad(parts.year, 4) : NOT_INFORMED,
    parts ? `${pad(parts.year, 4)}-${pad(parts.month)}` : NOT_INFORMED,
    filter,
    referenceDate
  );
}

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function formatMonthKey(key: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${MONTH_LABELS[Number(match[2]) - 1]}/${match[1].slice(2)}`;
}

export function openedFilterLabel(filter: string) {
  const months = openedWindowMonths(filter);
  if (months !== null) {
    if (months % 12 === 0 && months > 12) return `Abertas nos últimos ${months / 12} anos`;
    return months === 1 ? "Abertas no último mês" : `Abertas nos últimos ${months} meses`;
  }
  if (filter === NOT_INFORMED) return "Sem data de abertura";
  const range = openedYearRange(filter);
  if (range) return range.from === range.to ? `Abertas em ${range.from}` : `Abertas de ${range.from} a ${range.to}`;
  if (filter.length === 4) return `Abertas em ${filter}`;
  return `Abertas em ${formatMonthKey(filter)}`;
}

export function capitalBandLabel(key: string) {
  if (key === NOT_INFORMED) return "Capital não informado";
  return CAPITAL_BANDS.find((band) => band.key === key)?.label ?? key;
}

/* ------------------------------------------------------------------ chaves pré-calculadas */

/**
 * Todas as chaves de dimensão de uma empresa, calculadas UMA vez por carga de dados
 * (e não a cada filtro/gráfico). `day` = data de abertura ISO válida ou null.
 */
export type FacetKeys = {
  status: string;
  state: string;
  municipality: string;
  cnae: string;
  size: string;
  capital: string;
  year: string;
  month: string;
  day: string | null;
  /** Texto pesquisável já normalizado (foldText). */
  search: string;
};

export function computeFacetKeys(input: {
  status: string | null;
  state: string | null;
  municipalityKey: string | null | undefined;
  cnae: string | null;
  size: string | null;
  shareCapital: number | null;
  openedAt: string | null;
  searchText: string;
}): FacetKeys {
  const parts = parseIsoDay(input.openedAt);
  return {
    status: statusKey(input.status),
    state: stateKey(input.state),
    municipality: municipalityDimensionKey(input.municipalityKey),
    cnae: cnaeKey(input.cnae),
    size: sizeKey(input.size),
    capital: capitalBandKey(input.shareCapital),
    year: parts ? pad(parts.year, 4) : NOT_INFORMED,
    month: parts ? `${pad(parts.year, 4)}-${pad(parts.month)}` : NOT_INFORMED,
    day: parts ? formatIsoDay(parts) : null,
    search: foldText(input.searchText)
  };
}

/** Mesmo resultado de matchesOpenedFilter, usando as chaves pré-calculadas. */
export function matchesOpenedKeys(keys: FacetKeys, filter: string, referenceDate: string) {
  return matchesOpenedDay(keys.day, keys.year, keys.month, filter, referenceDate);
}
