/**
 * "Pergunte ao BuscaCNAE" (Fase 4 — IA Empresarial): tipos compartilhados entre servidor
 * e navegador. Este arquivo não importa nada de Node, React, banco ou dados locais.
 *
 * Princípio: o modelo de linguagem NUNCA calcula nem inventa números. Ele só escolhe uma
 * ferramenta (contrato fechado) e menciona entidades em texto; o servidor resolve as
 * entidades contra os dados reais, executa a ferramenta de forma determinística e monta a
 * resposta. Ver docs/IA_EMPRESARIAL.md.
 */
import type { CompanyTableFilters } from "@/lib/results/company-table-model";
import type { UniverseCounts } from "@/lib/analytics/universe";

/* ------------------------------------------------------------------ filtros resolvidos */

/**
 * Filtro RESOLVIDO do motor (chaves reais, nunca texto livre do modelo).
 * Superconjunto dos filtros da URL (CompanyTableFilters): aceita vários valores por
 * dimensão (ex.: comparar dois municípios). Só vira filtro de Lista/Mapa/Inteligência
 * quando cada dimensão tem no máximo um valor (ver `toTableFilters`).
 */
export type AiFilterSpec = {
  /** Busca textual (nome, CNPJ, bairro…) — mesma regra do campo de busca. */
  query?: string;
  /** "active" | "inactive" | chave exata de situação ("baixada", "inapta", "na"…). */
  status?: string;
  contact?: "any" | "phone" | "mobile" | "email";
  branch?: "matriz" | "filial";
  /** Siglas de UF. */
  states?: string[];
  /** Códigos IBGE (7 dígitos) ou "na". */
  municipalities?: string[];
  /** CNAE principal (7 dígitos) ou "na". */
  cnaes?: string[];
  /** Chaves de porte (sizeKey: "me", "epp", "demais"… ou "na"). */
  sizes?: string[];
  /** Faixas de capital (CAPITAL_BANDS[].key ou "na"). */
  capital?: string[];
  /** Mesmo formato de ?abertura= ("24m", "2021", "2021-07", "2019:2021", "na"). */
  opened?: string;
};

export type AiDimension = "municipality" | "state" | "cnae" | "size" | "status" | "capital" | "openedYear" | "openedMonth";

export const AI_DIMENSIONS: readonly AiDimension[] = ["municipality", "state", "cnae", "size", "status", "capital", "openedYear", "openedMonth"];

export const AI_DIMENSION_LABELS: Record<AiDimension, string> = {
  municipality: "município",
  state: "UF",
  cnae: "CNAE principal",
  size: "porte",
  status: "situação cadastral",
  capital: "faixa de capital social",
  openedYear: "ano de abertura",
  openedMonth: "mês de abertura (últimos 24 meses)"
};

export type AiCompanySort = "position" | "capital_desc" | "capital_asc" | "opened_desc" | "opened_asc" | "name";

export type AiRegionRef = { kind: "municipality" | "state"; key: string };

export type AiView = "lista" | "mapa" | "inteligencia";

export type AiMapLayer = "companies" | "concentration" | "regions";

/* ------------------------------------------------------------------ ferramentas */

/** Nomes das ferramentas (contratos) que o planejador pode escolher. */
export const AI_TOOL_NAMES = [
  "searchCompanies",
  "getCompaniesByCnae",
  "getCompaniesByCity",
  "aggregateCompanies",
  "compareRegions",
  "summarizeCompanies",
  "createChart",
  "showOnMap",
  "showInList",
  "showIntelligence"
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/** Chamada de ferramenta já RESOLVIDA e validada (o que o motor executa). */
export type AiToolCall =
  | { tool: "searchCompanies" | "getCompaniesByCnae" | "getCompaniesByCity"; filters: AiFilterSpec; sort: AiCompanySort; limit: number }
  | { tool: "aggregateCompanies"; filters: AiFilterSpec; groupBy: AiDimension; top: number }
  | { tool: "compareRegions"; filters: AiFilterSpec; regions: AiRegionRef[] }
  | { tool: "summarizeCompanies"; filters: AiFilterSpec }
  | { tool: "createChart"; filters: AiFilterSpec; groupBy: AiDimension; top: number }
  | { tool: "showOnMap"; filters: AiFilterSpec; layer: AiMapLayer | null }
  | { tool: "showInList" | "showIntelligence"; filters: AiFilterSpec };

/* ------------------------------------------------------------------ requisição */

/** Contexto que o navegador envia (tudo é revalidado no servidor). */
export type AiAskContext = {
  view: AiView;
  /** Parâmetros de filtro presentes na URL (q, situacao, uf, municipio, cnae…). */
  urlFilters: Record<string, string>;
  /** Última análise desta conversa (eco da resposta anterior; revalidada). */
  previous?: AiToolCall | null;
  /** Ignorar o contexto (tela e conversa) nesta pergunta. */
  reset?: boolean;
};

export type AiAskRequest = {
  question: string;
  context: AiAskContext;
};

/* ------------------------------------------------------------------ resposta */

/**
 * Natureza de cada informação exibida:
 * - dado: lido diretamente dos registros da fonte (Casa dos Dados);
 * - calculo: contagem, percentual, mediana ou diferença calculada pelo motor determinístico;
 * - ia: interpretação em linguagem natural gerada pelo modelo (sem números próprios).
 */
export type AiProvenance = "dado" | "calculo" | "ia";

export type AiKpi = { label: string; value: string; detail?: string; provenance: AiProvenance };

export type AiRankingRow = { key: string; label: string; count: number; share: number | null; filterable: boolean };

export type AiCompanyRow = {
  id: string;
  name: string;
  cnpj: string;
  city: string | null;
  state: string | null;
  cnae: string | null;
  status: string | null;
  size: string | null;
  openedAt: string | null;
  capital: number | null;
};

export type AiComparisonColumn = { key: string; label: string; kind: AiRegionRef["kind"] };
export type AiComparisonRow = { metric: string; values: string[]; provenance: AiProvenance; note?: string };

export type AiBlock =
  | { type: "kpis"; items: AiKpi[] }
  | {
      type: "ranking";
      dimension: AiDimension;
      title: string;
      rows: AiRankingRow[];
      total: number;
      /** Segmentos fora do top (somam ao total). */
      others: { segments: number; count: number } | null;
      /** Mostrar como gráfico (createChart) além da tabela. */
      chart: "bar" | "column" | null;
      provenance: AiProvenance;
    }
  | { type: "comparison"; columns: AiComparisonColumn[]; rows: AiComparisonRow[] }
  | { type: "companies"; total: number; rows: AiCompanyRow[]; sortLabel: string; provenance: AiProvenance };

/** Comando de interface (Lista / Mapa / Inteligência), sempre com filtros da URL válidos. */
export type AiUiCommand = {
  view: AiView;
  filters: CompanyTableFilters;
  layer: AiMapLayer | null;
  /** Descrição curta do que será aplicado ("Mapa · Cascavel/PR · ME"). */
  label: string;
};

export type AiAction = { label: string; command: AiUiCommand } | { label: string; question: string } | { label: string; href: string };

export type AiTransparency = {
  /** Rótulos dos filtros aplicados à análise. */
  filters: string[];
  /** Filtros vindos do contexto (tela atual ou pergunta anterior). */
  inherited: string[];
  /** Quantas empresas passaram pelos filtros (base da resposta). */
  analyzed: number;
  /** Universo analisado da busca (mesmo número das abas Empresas/Mapa/Inteligência). */
  universe: number;
  universeCounts: UniverseCounts | null;
  /** Período considerado (abertura) ou null. */
  period: string | null;
  /** Data de referência dos cálculos (AAAA-MM-DD, America/Sao_Paulo). */
  referenceDate: string;
  source: string;
  /** Como o texto da pergunta foi entendido ("Cascavel" → Cascavel/PR…). */
  notes: string[];
};

export type AiAnswerStatus = "ok" | "clarify" | "unsupported" | "error";

export type AiAnswer = {
  status: AiAnswerStatus;
  question: string;
  tool: AiToolName | null;
  /** Frase-resposta montada por template a partir do resultado (nunca pelo modelo). */
  headline: string;
  blocks: AiBlock[];
  transparency: AiTransparency | null;
  /** Interpretação do modelo (opcional) — passou pela verificação de números. */
  interpretation: string | null;
  /** Comando de interface a executar automaticamente (pedido explícito do usuário). */
  uiCommand: AiUiCommand | null;
  actions: AiAction[];
  followUps: string[];
  /** Eco para a próxima pergunta ("Mostre em gráfico", "Filtre somente ME"…). */
  context: AiToolCall | null;
  engine: { interpreter: "llm" | "regras"; fallback: boolean; model: string | null; ms: number };
};
