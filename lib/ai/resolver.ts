import { CAPITAL_BANDS, NOT_INFORMED } from "@/lib/analytics/dimensions";
import { mergeSpecs } from "@/lib/ai/filters";
import type { ClearableFilter, RawPlan, UnsupportedReason } from "@/lib/ai/plan";
import { normalizePlaceName } from "@/lib/geo/municipalities";
import { hasMunicipalityName, resolveActivity, resolveCity, resolveSize, resolveState, resolveStatus, UF_NAMES, type Vocabulary } from "@/lib/ai/vocabulary";
import type { AiAction, AiDimension, AiFilterSpec, AiRegionRef, AiToolCall } from "@/lib/ai/types";

/**
 * Plano (menções em texto) → chamada de ferramenta RESOLVIDA (chaves reais), mais o
 * contexto: filtros da tela/pergunta anterior são herdados por dimensão, e uma dimensão
 * citada na pergunta substitui a herdada ("E em Pato Branco?" troca só o município).
 */

export type ResolvedPlan =
  | {
      kind: "call";
      call: AiToolCall;
      notes: string[];
      /** Chaves do filtro que vieram do contexto (não da pergunta). */
      inherited: Array<keyof AiFilterSpec>;
      applyToView: boolean;
      /** Entidades citadas que não aparecem nesta busca (resultado tende a 0). */
      outsideUniverse: string[];
    }
  | { kind: "clarify"; message: string; options: AiAction[] }
  | { kind: "unsupported"; reason: UnsupportedReason; message: string };

export type ResolveContext = {
  vocabulary: Vocabulary;
  /** Filtros herdados (pergunta anterior ou URL atual). */
  baseSpec: AiFilterSpec;
  previous: AiToolCall | null;
  question: string;
};

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;
export const DEFAULT_TOP = 10;
export const MAX_TOP = 50;
export const MAX_COMPARE_REGIONS = 6;

export const UNSUPPORTED_MESSAGES: Record<UnsupportedReason, string> = {
  off_topic:
    "Só respondo sobre as empresas desta busca (quantidade, localização, CNAE, porte, situação, abertura, capital social). Tente, por exemplo, “Quais municípios têm mais empresas?”.",
  no_data:
    "Essa informação não existe nos dados da busca. Tenho, por empresa: situação cadastral, CNAE principal, município/UF, porte, capital social, data de abertura, matriz/filial e se há telefone ou e-mail — sem faturamento, funcionários, população ou projeções.",
  write: "O assistente só consulta e analisa: não altera, apaga nem cadastra dados, e não executa SQL.",
  sensitive: "O assistente não lista telefones, e-mails ou dados pessoais. Posso contar quantas empresas têm contato; os contatos ficam na aba Empresas e na ficha.",
  injection: "Não posso alterar minhas regras nem revelar configurações internas. Pergunte sobre as empresas desta busca.",
  external: "Não envio, exporto nem agendo nada a partir do chat. Use os botões de exportação da aba Empresas."
};

const CLEAR_TO_SPEC: Record<ClearableFilter, Array<keyof AiFilterSpec>> = {
  cities: ["municipalities"],
  states: ["states"],
  activities: ["cnaes"],
  sizes: ["sizes"],
  status: ["status"],
  opened: ["opened"],
  contact: ["contact"],
  branch: ["branch"],
  capital: ["capital"],
  text: ["query"]
};

const formatter = new Intl.NumberFormat("pt-BR");

function capitalBands(min: number | null, max: number | null, notes: string[]) {
  if (min === null && max === null) return undefined;
  const boundaries = [0, ...CAPITAL_BANDS.filter((band) => band.max !== null && band.max > 0).map((band) => band.max as number)];
  const snapUp = (value: number) => boundaries.find((boundary) => boundary >= value) ?? boundaries[boundaries.length - 1];
  const snapDown = (value: number) => [...boundaries].reverse().find((boundary) => boundary <= value) ?? 0;
  const low = min === null ? null : snapUp(min);
  const high = max === null ? null : snapDown(max);
  if (min !== null && low !== min) notes.push(`Capital: as faixas são fixas; usei “acima de R$ ${formatter.format(low ?? 0)}” (limite de faixa mais próximo de R$ ${formatter.format(min)}).`);
  if (max !== null && high !== max) notes.push(`Capital: as faixas são fixas; usei “até R$ ${formatter.format(high ?? 0)}” (limite de faixa mais próximo de R$ ${formatter.format(max)}).`);
  const bands = CAPITAL_BANDS.filter((band) => {
    const bandMin = band.key === "zero" ? -1 : band.min ?? 0;
    const bandMax = band.max ?? Number.POSITIVE_INFINITY;
    if (low !== null && bandMin < low) return false;
    if (high !== null && bandMax > high) return false;
    return true;
  }).map((band) => band.key);
  return bands.length > 0 ? bands : undefined;
}

/** "São Paulo" → UF SP: avisa que também é município (e como pedir o município). */
function noteStateCityHomonym(mention: string, uf: string, notes: string[]) {
  if (mention.trim().length <= 2) return;
  if (!hasMunicipalityName(normalizePlaceName(mention.replace(/^estado d[eo]s?\s+/i, "")))) return;
  const note = `“${mention.trim()}” foi entendido como a UF ${uf}. Para o município, escreva “cidade de ${UF_NAMES[uf]}”.`;
  if (!notes.includes(note)) notes.push(note);
}

function replaceMention(question: string, mention: string, replacement: string) {
  const index = question.toLowerCase().indexOf(mention.toLowerCase());
  return index >= 0 ? `${question.slice(0, index)}${replacement}${question.slice(index + mention.length)}` : `${question} (${replacement})`;
}

function previousGroupBy(previous: AiToolCall | null): AiDimension | null {
  if (!previous) return null;
  if (previous.tool === "aggregateCompanies" || previous.tool === "createChart") return previous.groupBy;
  return null;
}

export async function resolvePlan(plan: RawPlan, context: ResolveContext): Promise<ResolvedPlan> {
  const { vocabulary, question } = context;
  if (plan.action === "unsupported") {
    const reason = plan.unsupportedReason ?? "off_topic";
    return { kind: "unsupported", reason, message: UNSUPPORTED_MESSAGES[reason] };
  }
  if (plan.action === "clarify") {
    return {
      kind: "clarify",
      message: plan.clarification ?? "Pode detalhar a pergunta? Diga o que quer saber (contagem, ranking, comparação, lista) e o recorte (cidade, UF, atividade, porte, período).",
      options: []
    };
  }

  const notes: string[] = [];
  const outsideUniverse: string[] = [];
  const f = plan.filters;
  const resolved: AiFilterSpec = {};

  /* UF */
  const states: string[] = [];
  for (const mention of f.states ?? []) {
    const uf = resolveState(mention);
    if (uf) {
      if (!states.includes(uf)) states.push(uf);
      noteStateCityHomonym(mention, uf, notes);
    } else notes.push(`UF não reconhecida: “${mention}” (ignorada).`);
  }

  /* municípios: primeiro os inequívocos, depois os ambíguos com a UF do contexto */
  const municipalities: string[] = [];
  const preferred = new Set<string>([...states, ...(context.baseSpec.states ?? [])]);
  const cityMentions = f.cities ?? [];
  const pending: string[] = [];
  for (const mention of cityMentions) {
    const result = resolveCity(mention, vocabulary, []);
    if (result.status === "ok") {
      municipalities.push(result.ibge);
      preferred.add(result.label.slice(-2));
      if (result.note) notes.push(result.note);
      if (!result.inUniverse) outsideUniverse.push(result.label);
    } else pending.push(mention);
  }
  for (const mention of pending) {
    const result = resolveCity(mention, vocabulary, Array.from(preferred));
    if (result.status === "ok") {
      municipalities.push(result.ibge);
      if (result.note) notes.push(result.note);
      if (!result.inUniverse) outsideUniverse.push(result.label);
      continue;
    }
    if (result.status === "ambiguous") {
      return {
        kind: "clarify",
        message: `Há mais de um município chamado “${result.mention}”. Qual deles?`,
        options: result.options.map((option) => ({
          label: `${option.label}${option.inUniverse ? "" : " (fora desta busca)"}`,
          question: replaceMention(question, result.mention, option.label)
        }))
      };
    }
    // Menção que não é município: pode ser UF ("Paraná") dita como cidade.
    const uf = resolveState(mention);
    if (uf) {
      if (!states.includes(uf)) states.push(uf);
      continue;
    }
    return { kind: "clarify", message: `Não encontrei o município “${mention}” na base do IBGE. Confira a grafia ou informe a UF (ex.: “Cascavel/PR”).`, options: [] };
  }
  if (states.length > 0) resolved.states = states;
  if (municipalities.length > 0) resolved.municipalities = Array.from(new Set(municipalities));

  /* atividade → CNAE */
  const cnaes: string[] = [];
  for (const mention of f.activities ?? []) {
    const result = await resolveActivity(mention, vocabulary);
    if (result.status === "not_found") {
      return {
        kind: "clarify",
        message: `Não identifiquei a atividade “${mention}”. Descreva de outro jeito ou informe o código CNAE (ex.: 6920-6/01).`,
        options: []
      };
    }
    for (const code of result.cnaes) if (!cnaes.includes(code)) cnaes.push(code);
    if (result.note) notes.push(result.note);
    if (!result.inUniverse) outsideUniverse.push(`atividade “${mention}”`);
  }
  if (cnaes.length > 0) resolved.cnaes = cnaes.slice(0, 12);

  /* porte */
  const sizes: string[] = [];
  for (const mention of f.sizes ?? []) {
    const size = resolveSize(mention, vocabulary);
    if (!size) {
      notes.push(`Porte não reconhecido: “${mention}” (ignorado).`);
      continue;
    }
    if (!sizes.includes(size.key)) sizes.push(size.key);
    if (!size.inUniverse) outsideUniverse.push(`porte ${mention.toUpperCase()}`);
  }
  if (sizes.length > 0) resolved.sizes = sizes;

  /* situação */
  if (f.status) {
    const status = resolveStatus(f.status);
    if (status) resolved.status = status;
    else notes.push(`Situação não reconhecida: “${f.status}” (ignorada).`);
  }

  /* abertura */
  if (f.openedLastMonths !== null) resolved.opened = `${f.openedLastMonths}m`;
  else if (f.openedYearFrom !== null || f.openedYearTo !== null) {
    const from = f.openedYearFrom ?? 1800;
    const to = f.openedYearTo ?? from;
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    resolved.opened = low === high ? String(low) : `${String(low).padStart(4, "0")}:${String(high).padStart(4, "0")}`;
  }

  const capital = capitalBands(f.capitalMin, f.capitalMax, notes);
  if (capital) resolved.capital = capital;
  if (f.contact) resolved.contact = f.contact;
  if (f.branch) resolved.branch = f.branch;
  if (f.text) resolved.query = f.text;

  /* contexto */
  let base: AiFilterSpec = plan.contextMode === "reset" ? {} : { ...context.baseSpec };
  // Nova atividade = novo assunto: o recorte anterior (de outra atividade) não é herdado.
  if (resolved.cnaes && base.cnaes && !resolved.cnaes.some((code) => base.cnaes?.includes(code))) {
    base = {};
    notes.push("Nova atividade na pergunta: os filtros anteriores não foram herdados.");
  }
  for (const clear of f.clear ?? []) for (const key of CLEAR_TO_SPEC[clear]) delete base[key];
  // Cidade nova sem UF explícita não deve ficar presa à UF herdada de outra cidade.
  if (resolved.municipalities && !resolved.states && base.states) {
    const statesOfCities = new Set(resolved.municipalities.map((ibge) => ibge.slice(0, 2)));
    const baseUfCodes = base.states.map((uf) => UF_IBGE_PREFIX[uf]);
    if (!baseUfCodes.every((code) => statesOfCities.has(code))) delete base.states;
  }
  if (resolved.states && base.municipalities) delete base.municipalities;
  const inherited = (Object.keys(base) as Array<keyof AiFilterSpec>).filter((key) => resolved[key] === undefined);
  let spec = mergeSpecs(base, resolved);

  const previousDimension = previousGroupBy(context.previous);
  const top = Math.min(plan.limit ?? DEFAULT_TOP, MAX_TOP);

  let call: AiToolCall;
  switch (plan.action) {
    case "searchCompanies":
    case "getCompaniesByCnae":
    case "getCompaniesByCity": {
      const tool =
        plan.action === "getCompaniesByCnae" && !spec.cnaes ? "searchCompanies" : plan.action === "getCompaniesByCity" && !spec.municipalities ? "searchCompanies" : plan.action;
      call = { tool, filters: spec, sort: plan.sort ?? "position", limit: Math.min(plan.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT) };
      break;
    }
    case "aggregateCompanies":
      call = { tool: "aggregateCompanies", filters: spec, groupBy: plan.groupBy ?? previousDimension ?? "municipality", top };
      if (!plan.groupBy && !previousDimension) notes.push("Sem dimensão explícita: agrupei por município.");
      break;
    case "createChart": {
      let groupBy = plan.groupBy ?? previousDimension;
      if (!groupBy && context.previous?.tool === "compareRegions" && !plan.groupBy) {
        const regions = context.previous.regions;
        const kind = regions[0]?.kind;
        if (kind && regions.every((region) => region.kind === kind)) {
          groupBy = kind === "municipality" ? "municipality" : "state";
          spec = mergeSpecs(spec, kind === "municipality" ? { municipalities: regions.map((region) => region.key) } : { states: regions.map((region) => region.key) });
        }
      }
      if (!groupBy) notes.push("Sem dimensão explícita: gráfico por município.");
      call = { tool: "createChart", filters: spec, groupBy: groupBy ?? "municipality", top };
      break;
    }
    case "summarizeCompanies":
      call = { tool: "summarizeCompanies", filters: spec };
      break;
    case "compareRegions": {
      const regions: AiRegionRef[] = [];
      const labels: string[] = [];
      const mentions = plan.regions ?? [];
      const cityPreferred = new Set<string>([...states, ...(spec.states ?? [])]);
      // UFs escritas como UF; o resto é município (com desambiguação pelas UFs citadas).
      const asState = mentions.map((mention) => {
        const uf = resolveState(mention);
        const isFullStateName = uf !== null && (mention.trim().length === 2 || !/\b(cidade|municipio|município)\b/i.test(mention));
        return isFullStateName && mentions.every((other) => resolveState(other) !== null) ? uf : null;
      });
      for (const [index, mention] of mentions.entries()) {
        const uf = asState[index];
        if (uf) {
          if (!regions.some((region) => region.kind === "state" && region.key === uf)) regions.push({ kind: "state", key: uf });
          noteStateCityHomonym(mention, uf, notes);
          continue;
        }
        const first = resolveCity(mention, vocabulary, []);
        if (first.status === "ok") cityPreferred.add(first.label.slice(-2));
      }
      for (const [index, mention] of mentions.entries()) {
        if (asState[index]) continue;
        const result = resolveCity(mention, vocabulary, Array.from(cityPreferred));
        if (result.status === "ok") {
          if (!regions.some((region) => region.key === result.ibge)) regions.push({ kind: "municipality", key: result.ibge });
          labels.push(result.label);
          if (result.note) notes.push(result.note);
          if (!result.inUniverse) outsideUniverse.push(result.label);
        } else if (result.status === "ambiguous") {
          return {
            kind: "clarify",
            message: `Há mais de um município chamado “${result.mention}”. Qual deles?`,
            options: result.options.map((option) => ({ label: option.label, question: replaceMention(question, result.mention, option.label) }))
          };
        } else {
          const uf = resolveState(mention);
          if (uf) regions.push({ kind: "state", key: uf });
          else return { kind: "clarify", message: `Não encontrei “${mention}” como município ou UF.`, options: [] };
        }
      }
      // "Compare com Pato Branco" depois de uma pergunta sobre Cascavel (ou "Compare com MG"
      // depois de SP × RJ): as regiões do contexto entram antes da nova.
      if (mentions.length === 0 && context.previous?.tool === "compareRegions") regions.push(...context.previous.regions);
      if (mentions.length === 1 && regions.length === 1) {
        const kind = regions[0].kind;
        const fromBase = (kind === "municipality" ? base.municipalities : base.states) ?? [];
        const merged: AiRegionRef[] = fromBase.filter((key) => key !== NOT_INFORMED && key !== regions[0].key).map((key) => ({ kind, key }));
        regions.unshift(...merged);
      }
      if (regions.length < 2) {
        return {
          kind: "clarify",
          message: "Quais regiões você quer comparar? Cite dois ou mais municípios ou UFs — por exemplo, “Compare Cascavel e Pato Branco”.",
          options: []
        };
      }
      if (regions.length > MAX_COMPARE_REGIONS) notes.push(`Comparação limitada às ${MAX_COMPARE_REGIONS} primeiras regiões citadas.`);
      // A dimensão comparada sai do filtro comum (cada coluna aplica a própria região).
      const common = { ...spec };
      if (regions.some((region) => region.kind === "municipality")) delete common.municipalities;
      if (regions.some((region) => region.kind === "state")) {
        delete common.states;
        delete common.municipalities;
      }
      call = { tool: "compareRegions", filters: common, regions: regions.slice(0, MAX_COMPARE_REGIONS) };
      break;
    }
    case "showOnMap":
      call = { tool: "showOnMap", filters: spec, layer: plan.mapLayer };
      break;
    case "showInList":
      call = { tool: "showInList", filters: spec };
      break;
    case "showIntelligence":
      call = { tool: "showIntelligence", filters: spec };
      break;
    default:
      return { kind: "unsupported", reason: "off_topic", message: UNSUPPORTED_MESSAGES.off_topic };
  }

  return { kind: "call", call, notes, inherited, applyToView: plan.applyToView, outsideUniverse };
}

/** Prefixo IBGE (2 dígitos) de cada UF — o código do município começa pelo da UF. */
export const UF_IBGE_PREFIX: Record<string, string> = {
  RO: "11",
  AC: "12",
  AM: "13",
  RR: "14",
  PA: "15",
  AP: "16",
  TO: "17",
  MA: "21",
  PI: "22",
  CE: "23",
  RN: "24",
  PB: "25",
  PE: "26",
  AL: "27",
  SE: "28",
  BA: "29",
  MG: "31",
  ES: "32",
  RJ: "33",
  SP: "35",
  PR: "41",
  SC: "42",
  RS: "43",
  MS: "50",
  MT: "51",
  GO: "52",
  DF: "53"
};

export function stateOfMunicipality(ibge: string) {
  const prefix = ibge.slice(0, 2);
  return Object.entries(UF_IBGE_PREFIX).find(([, code]) => code === prefix)?.[0] ?? null;
}

export { UF_NAMES };
