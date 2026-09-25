import { AI_DIMENSIONS, AI_TOOL_NAMES, type AiCompanySort, type AiDimension, type AiMapLayer, type AiToolName } from "@/lib/ai/types";
import { sanitizeText } from "@/lib/ai/filters";

/**
 * Contrato do PLANEJADOR (modelo de linguagem ou intérprete por regras).
 *
 * O planejador devolve só isto: qual ferramenta usar e quais entidades foram
 * MENCIONADAS (texto). Não há campo para números de resultado, SQL, código, URL ou
 * instrução de sistema — e qualquer saída fora do formato é descartada por
 * `validateRawPlan` antes de chegar ao motor.
 */

export const PLAN_ACTIONS = [...AI_TOOL_NAMES, "clarify", "unsupported"] as const;
export type PlanAction = AiToolName | "clarify" | "unsupported";

export const UNSUPPORTED_REASONS = ["off_topic", "no_data", "write", "sensitive", "injection", "external"] as const;
export type UnsupportedReason = (typeof UNSUPPORTED_REASONS)[number];

export const CLEARABLE_FILTERS = ["cities", "states", "activities", "sizes", "status", "opened", "contact", "branch", "capital", "text"] as const;
export type ClearableFilter = (typeof CLEARABLE_FILTERS)[number];

const SORTS: readonly AiCompanySort[] = ["position", "capital_desc", "capital_asc", "opened_desc", "opened_asc", "name"];
const LAYERS: readonly AiMapLayer[] = ["companies", "concentration", "regions"];

export type RawFilters = {
  cities: string[] | null;
  states: string[] | null;
  activities: string[] | null;
  sizes: string[] | null;
  status: string | null;
  openedLastMonths: number | null;
  openedYearFrom: number | null;
  openedYearTo: number | null;
  contact: "any" | "phone" | "mobile" | "email" | null;
  branch: "matriz" | "filial" | null;
  capitalMin: number | null;
  capitalMax: number | null;
  text: string | null;
  /** Filtros herdados a remover ("tire o filtro de porte"). */
  clear: ClearableFilter[] | null;
};

export type RawPlan = {
  action: PlanAction;
  contextMode: "inherit" | "reset";
  filters: RawFilters;
  groupBy: AiDimension | null;
  /** Regiões a comparar (menções de município ou UF). */
  regions: string[] | null;
  sort: AiCompanySort | null;
  limit: number | null;
  mapLayer: AiMapLayer | null;
  /** O usuário pediu para aplicar o filtro na tela atual ("filtre somente ME"). */
  applyToView: boolean;
  clarification: string | null;
  unsupportedReason: UnsupportedReason | null;
};

export const EMPTY_RAW_FILTERS: RawFilters = {
  cities: null,
  states: null,
  activities: null,
  sizes: null,
  status: null,
  openedLastMonths: null,
  openedYearFrom: null,
  openedYearTo: null,
  contact: null,
  branch: null,
  capitalMin: null,
  capitalMax: null,
  text: null,
  clear: null
};

export function emptyPlan(action: PlanAction): RawPlan {
  return {
    action,
    contextMode: "inherit",
    filters: { ...EMPTY_RAW_FILTERS },
    groupBy: null,
    regions: null,
    sort: null,
    limit: null,
    mapLayer: null,
    applyToView: false,
    clarification: null,
    unsupportedReason: null
  };
}

/* ------------------------------------------------------------------ validação */

function stringList(value: unknown, maxItems = 8, maxLength = 60) {
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => sanitizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
  return out.length > 0 ? out : null;
}

function integer(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function money(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export type PlanValidation = { ok: true; plan: RawPlan } | { ok: false; error: string };

/** Saída do planejador → plano tipado. Campos desconhecidos são ignorados; tipos errados, descartados. */
export function validateRawPlan(input: unknown): PlanValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "plano não é um objeto" };
  const source = input as Record<string, unknown>;
  const action = oneOf(source.action, PLAN_ACTIONS);
  if (!action) return { ok: false, error: `ação inválida: ${String(source.action).slice(0, 40)}` };

  const rawFilters = source.filters && typeof source.filters === "object" && !Array.isArray(source.filters) ? (source.filters as Record<string, unknown>) : {};
  const currentYear = new Date().getUTCFullYear() + 1;
  const clear = Array.isArray(rawFilters.clear)
    ? rawFilters.clear.map((item) => oneOf(item, CLEARABLE_FILTERS)).filter((item): item is ClearableFilter => item !== null)
    : [];

  const filters: RawFilters = {
    cities: stringList(rawFilters.cities),
    states: stringList(rawFilters.states, 27, 30),
    activities: stringList(rawFilters.activities, 6, 80),
    sizes: stringList(rawFilters.sizes, 6, 40),
    status: typeof rawFilters.status === "string" ? sanitizeText(rawFilters.status, 30) || null : null,
    openedLastMonths: integer(rawFilters.openedLastMonths, 1, 600),
    openedYearFrom: integer(rawFilters.openedYearFrom, 1800, currentYear),
    openedYearTo: integer(rawFilters.openedYearTo, 1800, currentYear),
    contact: oneOf(rawFilters.contact, ["any", "phone", "mobile", "email"] as const),
    branch: oneOf(rawFilters.branch, ["matriz", "filial"] as const),
    capitalMin: money(rawFilters.capitalMin),
    capitalMax: money(rawFilters.capitalMax),
    text: typeof rawFilters.text === "string" ? sanitizeText(rawFilters.text) || null : null,
    clear: clear.length > 0 ? clear : null
  };

  return {
    ok: true,
    plan: {
      action,
      contextMode: source.contextMode === "reset" ? "reset" : "inherit",
      filters,
      groupBy: oneOf(source.groupBy, AI_DIMENSIONS),
      regions: stringList(source.regions, 6),
      sort: oneOf(source.sort, SORTS),
      limit: integer(source.limit, 1, 50),
      mapLayer: oneOf(source.mapLayer, LAYERS),
      applyToView: source.applyToView === true,
      clarification: typeof source.clarification === "string" ? sanitizeText(source.clarification, 240) || null : null,
      unsupportedReason: oneOf(source.unsupportedReason, UNSUPPORTED_REASONS)
    }
  };
}

/* ------------------------------------------------------------------ JSON Schema (saída estruturada) */

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const stringArray = nullable({ type: "array", items: { type: "string" } });

/** Schema estrito (OpenAI Structured Outputs): todos os campos obrigatórios, nada além deles. */
export const RAW_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "contextMode", "filters", "groupBy", "regions", "sort", "limit", "mapLayer", "applyToView", "clarification", "unsupportedReason"],
  properties: {
    action: { type: "string", enum: [...PLAN_ACTIONS] },
    contextMode: { type: "string", enum: ["inherit", "reset"] },
    filters: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(EMPTY_RAW_FILTERS),
      properties: {
        cities: stringArray,
        states: stringArray,
        activities: stringArray,
        sizes: stringArray,
        status: nullable({ type: "string" }),
        openedLastMonths: nullable({ type: "integer" }),
        openedYearFrom: nullable({ type: "integer" }),
        openedYearTo: nullable({ type: "integer" }),
        contact: nullable({ type: "string", enum: ["any", "phone", "mobile", "email"] }),
        branch: nullable({ type: "string", enum: ["matriz", "filial"] }),
        capitalMin: nullable({ type: "number" }),
        capitalMax: nullable({ type: "number" }),
        text: nullable({ type: "string" }),
        clear: nullable({ type: "array", items: { type: "string", enum: [...CLEARABLE_FILTERS] } })
      }
    },
    groupBy: nullable({ type: "string", enum: [...AI_DIMENSIONS] }),
    regions: stringArray,
    sort: nullable({ type: "string", enum: [...SORTS] }),
    limit: nullable({ type: "integer" }),
    mapLayer: nullable({ type: "string", enum: [...LAYERS] }),
    applyToView: { type: "boolean" },
    clarification: nullable({ type: "string" }),
    unsupportedReason: nullable({ type: "string", enum: [...UNSUPPORTED_REASONS] })
  }
} as const;
