import { NOT_INFORMED, openedFilterLabel } from "@/lib/analytics/dimensions";
import type { AnalyticsRecord } from "@/lib/analytics/metrics";
import type { UniverseCounts } from "@/lib/analytics/universe";
import { listMunicipalities } from "@/lib/geo/municipalities";
import type { MapCompany } from "@/lib/map/types";
import { parseCompanyFilters } from "@/lib/results/filter-params";
import { describeSpec, sanitizeFilterSpec, specFromTableFilters } from "@/lib/ai/filters";
import { guardQuestion } from "@/lib/ai/guard";
import { interpretWithLlm, planWithLlm, type LlmConfig } from "@/lib/ai/llm";
import type { RawPlan } from "@/lib/ai/plan";
import { interpretWithRules } from "@/lib/ai/interpreter-rules";
import { DEFAULT_LIST_LIMIT, DEFAULT_TOP, MAX_COMPARE_REGIONS, MAX_LIST_LIMIT, MAX_TOP, resolvePlan, UNSUPPORTED_MESSAGES } from "@/lib/ai/resolver";
import { buildUiCommand, executeTool, formatCount, periodLabel } from "@/lib/ai/tools";
import { buildVocabulary, type Vocabulary } from "@/lib/ai/vocabulary";
import {
  AI_DIMENSIONS,
  AI_TOOL_NAMES,
  type AiAction,
  type AiAnswer,
  type AiCompanySort,
  type AiDimension,
  type AiFilterSpec,
  type AiMapLayer,
  type AiRegionRef,
  type AiToolCall,
  type AiToolName,
  type AiView
} from "@/lib/ai/types";

/**
 * Orquestrador do “Pergunte ao BuscaCNAE”:
 *
 *   pergunta → barreira (guard) → planejador (LLM ou regras) → validação do plano
 *            → resolução de entidades + contexto → ferramenta determinística
 *            → resposta por template (+ interpretação opcional com verificação de números)
 *            → comando de interface (Lista / Mapa / Inteligência)
 *
 * Função pura em relação aos dados: recebe o universo já carregado e autorizado.
 */

export type AssistantDataset = {
  records: readonly AnalyticsRecord[];
  companies: readonly MapCompany[];
  referenceDate: string;
  universe: UniverseCounts | null;
  source: { headline: string; createdAt: string | null; unlocked: boolean; lockedCount: number };
};

export type AssistantOptions = {
  llm: LlmConfig | null;
  interpretation: boolean;
  now?: () => number;
};

const VIEWS: readonly AiView[] = ["lista", "mapa", "inteligencia"];
const SORTS: readonly AiCompanySort[] = ["position", "capital_desc", "capital_asc", "opened_desc", "opened_asc", "name"];
const LAYERS: readonly AiMapLayer[] = ["companies", "concentration", "regions"];
const ANALYTIC_TOOLS = new Set<AiToolName>(["aggregateCompanies", "createChart", "compareRegions", "summarizeCompanies", "searchCompanies", "getCompaniesByCity", "getCompaniesByCnae"]);

const vocabularyCache = new WeakMap<readonly AnalyticsRecord[], Vocabulary>();

function vocabularyFor(records: readonly AnalyticsRecord[]) {
  let vocabulary = vocabularyCache.get(records);
  if (!vocabulary) {
    vocabulary = buildVocabulary(records);
    vocabularyCache.set(records, vocabulary);
  }
  return vocabulary;
}

function int(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Revalida o eco da análise anterior (vem do navegador: não confiável). */
export function sanitizePreviousCall(input: unknown): AiToolCall | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const tool = typeof source.tool === "string" && (AI_TOOL_NAMES as readonly string[]).includes(source.tool) ? (source.tool as AiToolName) : null;
  if (!tool) return null;
  const filters = sanitizeFilterSpec(source.filters);
  const groupBy = typeof source.groupBy === "string" && (AI_DIMENSIONS as readonly string[]).includes(source.groupBy) ? (source.groupBy as AiDimension) : "municipality";
  switch (tool) {
    case "searchCompanies":
    case "getCompaniesByCnae":
    case "getCompaniesByCity":
      return {
        tool,
        filters,
        sort: typeof source.sort === "string" && (SORTS as readonly string[]).includes(source.sort) ? (source.sort as AiCompanySort) : "position",
        limit: int(source.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT)
      };
    case "aggregateCompanies":
    case "createChart":
      return { tool, filters, groupBy, top: int(source.top, DEFAULT_TOP, 1, MAX_TOP) };
    case "compareRegions": {
      const regions: AiRegionRef[] = [];
      if (Array.isArray(source.regions)) {
        for (const item of source.regions.slice(0, MAX_COMPARE_REGIONS)) {
          if (!item || typeof item !== "object") continue;
          const { kind, key } = item as { kind?: unknown; key?: unknown };
          if (kind === "municipality" && typeof key === "string" && /^\d{7}$/.test(key)) regions.push({ kind, key });
          if (kind === "state" && typeof key === "string" && /^[A-Z]{2}$/.test(key)) regions.push({ kind, key });
        }
      }
      return regions.length >= 2 ? { tool, filters, regions } : null;
    }
    case "summarizeCompanies":
      return { tool, filters };
    case "showOnMap":
      return { tool, filters, layer: typeof source.layer === "string" && (LAYERS as readonly string[]).includes(source.layer) ? (source.layer as AiMapLayer) : null };
    case "showInList":
    case "showIntelligence":
      return { tool, filters };
  }
}

/** Filtros da URL enviados pelo navegador → spec (mesmo parser da página). */
export function specFromUrlFilters(input: unknown): AiFilterSpec {
  const params = new URLSearchParams();
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 30)) {
      if (typeof value === "string" && key.length <= 20) params.set(key, value.slice(0, 200));
    }
  }
  return specFromTableFilters(parseCompanyFilters(params));
}

/** Recorte "em foco" da análise anterior (comparação → as regiões comparadas). */
function focusSpec(previous: AiToolCall): AiFilterSpec {
  if (previous.tool !== "compareRegions") return previous.filters;
  const municipalities = previous.regions.filter((region) => region.kind === "municipality").map((region) => region.key);
  const states = previous.regions.filter((region) => region.kind === "state").map((region) => region.key);
  return {
    ...previous.filters,
    ...(municipalities.length === previous.regions.length ? { municipalities } : {}),
    ...(states.length === previous.regions.length ? { states } : {})
  };
}

function baseAnswer(question: string, started: number, now: () => number, engine: AiAnswer["engine"]): AiAnswer {
  return {
    status: "ok",
    question,
    tool: null,
    headline: "",
    blocks: [],
    transparency: null,
    interpretation: null,
    uiCommand: null,
    actions: [],
    followUps: [],
    context: null,
    engine: { ...engine, ms: Math.round(now() - started) }
  };
}

const EXAMPLES = ["Quais municípios têm mais empresas?", "Quantas estão ativas?", "Resumo das empresas abertas nos últimos 2 anos"];

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

export async function answerQuestion(request: unknown, dataset: AssistantDataset, options: AssistantOptions): Promise<AiAnswer> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const body = request && typeof request === "object" ? (request as Record<string, unknown>) : {};
  const contextInput = body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {};
  const view: AiView = typeof contextInput.view === "string" && (VIEWS as readonly string[]).includes(contextInput.view) ? (contextInput.view as AiView) : "lista";
  let engine: AiAnswer["engine"] = { interpreter: options.llm ? "llm" : "regras", fallback: false, model: options.llm?.model ?? null, ms: 0 };

  const guard = guardQuestion(body.question);
  if (!guard.ok) {
    const answer = baseAnswer(typeof body.question === "string" ? body.question.slice(0, 500) : "", started, now, { ...engine, interpreter: "regras", model: null });
    answer.status = guard.reason === "empty" || guard.reason === "too_long" ? "clarify" : "unsupported";
    answer.headline = guard.message;
    answer.followUps = EXAMPLES;
    return answer;
  }
  const question = guard.question;

  const ignoreContext = contextInput.reset === true;
  const previous = ignoreContext ? null : sanitizePreviousCall(contextInput.previous);
  const urlSpec = ignoreContext ? {} : specFromUrlFilters(contextInput.urlFilters);
  const baseSpec = previous ? focusSpec(previous) : urlSpec;
  const vocabulary = vocabularyFor(dataset.records);
  const previousGroupBy = previous && (previous.tool === "aggregateCompanies" || previous.tool === "createChart") ? previous.groupBy : null;

  /* ---------- planejar */
  let plan: RawPlan | null = null;
  if (options.llm) {
    const top = (map: Map<string, number>, labels: Map<string, string> | null, limit: number) =>
      Array.from(map.entries())
        .filter(([key]) => key !== NOT_INFORMED)
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit)
        .map(([key]) => (labels ? labels.get(key) ?? key : key));
    plan = await planWithLlm(
      question,
      {
        view,
        referenceDate: dataset.referenceDate,
        currentFilters: describeSpec(baseSpec, vocabulary.labels),
        previousTool: previous?.tool ?? null,
        previousGroupBy,
        universeSize: dataset.records.length,
        vocabulary: {
          municipalities: top(vocabulary.municipalityCounts, vocabulary.labels.municipality, 30),
          states: top(vocabulary.stateCounts, null, 27),
          cnaes: top(vocabulary.cnaeCounts, vocabulary.labels.cnae, 15),
          sizes: top(vocabulary.sizeCounts, vocabulary.labels.size, 8),
          statuses: top(vocabulary.statusCounts, vocabulary.labels.status, 8)
        }
      },
      options.llm
    );
    if (!plan) engine = { ...engine, interpreter: "regras", fallback: true };
  }
  if (!plan) {
    plan = interpretWithRules(question, { vocabulary, referenceDate: dataset.referenceDate, previousTool: previous?.tool ?? null, previousGroupBy });
  }

  /* ---------- resolver */
  const resolved = await resolvePlan(plan, { vocabulary, baseSpec, previous, question });
  if (resolved.kind === "unsupported") {
    const answer = baseAnswer(question, started, now, engine);
    answer.status = "unsupported";
    answer.headline = resolved.message || UNSUPPORTED_MESSAGES.off_topic;
    answer.followUps = EXAMPLES;
    answer.context = previous;
    return answer;
  }
  if (resolved.kind === "clarify") {
    const answer = baseAnswer(question, started, now, engine);
    answer.status = "clarify";
    answer.headline = resolved.message;
    answer.actions = resolved.options;
    answer.followUps = resolved.options.length > 0 ? [] : EXAMPLES;
    answer.context = previous;
    return answer;
  }

  /* ---------- executar */
  const call = resolved.call;
  const extraMunicipalityLabels = new Map<string, string>();
  const allMunicipalities = [
    ...(call.filters.municipalities ?? []),
    ...(call.tool === "compareRegions" ? call.regions.filter((region) => region.kind === "municipality").map((region) => region.key) : [])
  ];
  for (const ibge of allMunicipalities) {
    if (vocabulary.labels.municipality.has(ibge) || ibge === NOT_INFORMED) continue;
    const found = listMunicipalities().find((item) => item.ibge === ibge);
    if (found) extraMunicipalityLabels.set(ibge, `${found.name}/${found.stateCode}`);
  }
  const companiesById = new Map(dataset.companies.map((company) => [company.id, company]));
  const toolContext = {
    records: dataset.records,
    companiesById,
    referenceDate: dataset.referenceDate,
    universe: dataset.universe,
    labels: vocabulary.labels,
    extraMunicipalityLabels,
    view
  };
  const result = executeTool(call, toolContext);

  let uiCommand = result.uiCommand;
  const actions: AiAction[] = [...result.actions];
  if (!uiCommand && resolved.applyToView && ANALYTIC_TOOLS.has(call.tool)) {
    uiCommand = buildUiCommand(call.filters, view, toolContext, null);
  }

  const labelLookup = {
    ...vocabulary.labels,
    municipality: new Map([...vocabulary.labels.municipality, ...extraMunicipalityLabels])
  };
  const inheritedSpec: AiFilterSpec = {};
  for (const key of resolved.inherited) (inheritedSpec as Record<string, unknown>)[key] = call.filters[key];
  const notes = [...resolved.notes];
  if (resolved.outsideUniverse.length > 0) {
    notes.push(
      `${resolved.outsideUniverse.join(", ")} não aparece(m) entre as empresas desta busca — a análise só considera o resultado da busca. Para esse recorte, faça uma nova busca.`
    );
    actions.push({ label: "Fazer nova busca", href: "/dashboard/search" });
  }
  if (!dataset.source.unlocked) {
    notes.push(
      `Antes da compra, a análise usa só a amostra liberada (${formatCount(dataset.records.length)} empresa(s))${dataset.source.lockedCount > 0 ? `; outras ${formatCount(dataset.source.lockedCount)} entram após a compra da lista` : ""}.`
    );
  }
  const createdAt = formatDate(dataset.source.createdAt);
  const answer = baseAnswer(question, started, now, engine);
  answer.tool = call.tool;
  answer.headline = result.headline;
  answer.blocks = result.blocks;
  answer.uiCommand = uiCommand;
  answer.actions = actions.slice(0, 10);
  answer.followUps = result.followUps.slice(0, 4);
  answer.context = call;
  answer.transparency = {
    filters: describeSpec(call.filters, labelLookup),
    inherited: describeSpec(inheritedSpec, labelLookup),
    analyzed: result.analyzed,
    universe: dataset.records.length,
    universeCounts: dataset.universe,
    period: periodLabel(call.filters) ?? (call.filters.opened ? openedFilterLabel(call.filters.opened) : null),
    referenceDate: dataset.referenceDate,
    source: `Casa dos Dados — empresas da busca “${dataset.source.headline}”${createdAt ? ` (${createdAt})` : ""}`,
    notes
  };

  /* ---------- interpretação (opcional) */
  if (options.llm && options.interpretation && ANALYTIC_TOOLS.has(call.tool) && result.analyzed > 0 && call.tool !== "searchCompanies" && call.tool !== "getCompaniesByCity" && call.tool !== "getCompaniesByCnae") {
    const interpretation = await interpretWithLlm(result.headline, result.facts, options.llm);
    answer.interpretation = interpretation.text;
  }
  answer.engine = { ...engine, ms: Math.round(now() - started) };
  return answer;
}


