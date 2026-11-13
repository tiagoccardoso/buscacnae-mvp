import type { DealView, PipelineStage } from "./types";

/**
 * Indicadores comerciais do pipeline (puros, calculados sobre os negócios já filtrados).
 * "Atrasado" = próximo contato agendado no passado em negócio aberto.
 */
export function summarizePipeline(deals: Array<Pick<DealView, "stageId" | "amountCents" | "nextContactAt" | "prospectId">>, stages: PipelineStage[], now: number) {
  const kindById = new Map(stages.map((stage) => [stage.id, stage.kind]));
  let open = 0;
  let openValueCents = 0;
  let won = 0;
  let wonValueCents = 0;
  let lost = 0;
  let manual = 0;
  let overdueContacts = 0;
  let scheduledContacts = 0;
  for (const deal of deals) {
    const kind = kindById.get(deal.stageId) ?? "open";
    if (deal.prospectId) manual += 1;
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
    if (deal.nextContactAt) {
      const at = Date.parse(deal.nextContactAt);
      if (Number.isFinite(at) && at < now) overdueContacts += 1;
      else scheduledContacts += 1;
    }
  }
  const closed = won + lost;
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
    /** Taxa de ganho entre os fechados (null sem fechamentos). */
    winRate: closed ? Math.round((won / closed) * 100) : null
  };
}
