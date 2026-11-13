import type { DealView, PipelineStage } from "./types";

/**
 * Indicadores comerciais do CRM (puros, calculados sobre os negócios JÁ filtrados pela
 * tela — os mesmos filtros valem para a lista, o Kanban e o resumo).
 *
 * Regras de cálculo (Fase 9):
 *   - Ativos: negócios em etapa aberta (open). Arquivados não entram (a consulta já os exclui).
 *   - Novos no período: negócios que ENTRARAM no CRM (createdAt) a partir de `periodStart`,
 *     em qualquer etapa.
 *   - Propostas pendentes: negócios abertos em etapa cujo nome contém "proposta"
 *     (pipeline padrão: "Proposta"; etapas renomeadas seguem a mesma regra).
 *   - Em negociação: negócios abertos que já saíram da etapa de entrada (primeira etapa
 *     aberta) e não estão em etapa de proposta.
 *   - Ganhos / Perdidos: negócios em etapa do tipo won / lost.
 *   - Valor potencial do funil: soma do valor dos negócios abertos (sem valor = 0).
 *   - Taxa de conversão: ganhos ÷ (ganhos + perdidos), em %. Sem fechamentos = null.
 *   - Sem acompanhamento: aberto, sem próximo contato futuro e sem interação registrada
 *     (ou entrada no CRM, se nunca houve interação) há mais de STALE_DAYS dias.
 *   - Contatos atrasados: aberto com próximo contato agendado no passado.
 */

export const STALE_DAYS = 14;
const DAY_MS = 86_400_000;

type MetricDeal = Pick<DealView, "stageId" | "amountCents" | "nextContactAt" | "prospectId" | "createdAt"> &
  Partial<Pick<DealView, "lastInteractionAt">>;

export function isProposalStage(stage: Pick<PipelineStage, "name" | "kind"> | undefined) {
  return Boolean(stage && stage.kind === "open" && /propost/i.test(stage.name.normalize("NFD").replace(/[̀-ͯ]/g, "")));
}

/** Etapa de entrada: a primeira etapa aberta pela posição. */
export function entryStageId(stages: PipelineStage[]) {
  return [...stages].sort((a, b) => a.position - b.position).find((stage) => stage.kind === "open")?.id ?? null;
}

export function isStale(deal: Pick<MetricDeal, "nextContactAt" | "createdAt" | "lastInteractionAt">, now: number) {
  const next = deal.nextContactAt ? Date.parse(deal.nextContactAt) : NaN;
  if (Number.isFinite(next) && next >= now) return false;
  const lastTouch = Date.parse(deal.lastInteractionAt ?? deal.createdAt);
  return Number.isFinite(lastTouch) && now - lastTouch > STALE_DAYS * DAY_MS;
}

/** Dias desde a última interação (ou entrada no CRM). */
export function daysSinceTouch(deal: Pick<MetricDeal, "createdAt" | "lastInteractionAt">, now: number) {
  const lastTouch = Date.parse(deal.lastInteractionAt ?? deal.createdAt);
  return Number.isFinite(lastTouch) ? Math.max(0, Math.floor((now - lastTouch) / DAY_MS)) : null;
}

export function summarizePipeline(deals: MetricDeal[], stages: PipelineStage[], now: number, options: { periodStart?: number | null } = {}) {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const entryId = entryStageId(stages);
  const periodStart = options.periodStart ?? null;
  let open = 0;
  let openValueCents = 0;
  let won = 0;
  let wonValueCents = 0;
  let lost = 0;
  let manual = 0;
  let overdueContacts = 0;
  let scheduledContacts = 0;
  let newInPeriod = 0;
  let proposalsPending = 0;
  let inNegotiation = 0;
  let stale = 0;
  for (const deal of deals) {
    const stage = stageById.get(deal.stageId);
    const kind = stage?.kind ?? "open";
    if (deal.prospectId) manual += 1;
    if (periodStart !== null) {
      const created = Date.parse(deal.createdAt);
      if (Number.isFinite(created) && created >= periodStart) newInPeriod += 1;
    }
    if (kind === "won") {
      won += 1;
      wonValueCents += deal.amountCents ?? 0;
      continue;
    }
    if (kind === "lost") {
      lost += 1;
      continue;
    }
    open += 1;
    openValueCents += deal.amountCents ?? 0;
    if (isProposalStage(stage)) proposalsPending += 1;
    else if (stage && stage.id !== entryId) inNegotiation += 1;
    if (isStale(deal, now)) stale += 1;
    if (deal.nextContactAt) {
      const at = Date.parse(deal.nextContactAt);
      if (Number.isFinite(at) && at < now) overdueContacts += 1;
      else scheduledContacts += 1;
    }
  }
  const closed = won + lost;
  const conversionRate = closed ? Math.round((won / closed) * 100) : null;
  return {
    total: deals.length,
    open,
    openValueCents,
    won,
    wonValueCents,
    lost,
    manual,
    overdueContacts,
    scheduledContacts,
    newInPeriod,
    proposalsPending,
    inNegotiation,
    stale,
    conversionRate,
    /** Mantido por compatibilidade: igual a conversionRate. */
    winRate: conversionRate
  };
}

export const PERIODS = { "7": 7, "30": 30, "90": 90 } as const;
export type PeriodKey = keyof typeof PERIODS;

export function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PERIODS, value);
}
