import { sortStages } from "./pipeline";
import type { PipelineStage } from "./types";

/**
 * Ordenação do Kanban por posição fracionária: mover um card grava UMA linha
 * (a posição média entre os vizinhos). Quando o intervalo fica pequeno demais,
 * a coluna é renumerada com espaçamento uniforme.
 */
export const POSITION_STEP = 1024;
export const MIN_POSITION_GAP = 1e-6;

export type BoardCard = { id: string; stageId: string; position: number };

export function positionBetween(before: number | null, after: number | null) {
  if (before === null && after === null) return { position: POSITION_STEP, needsRebalance: false };
  if (before === null) return { position: (after as number) - POSITION_STEP, needsRebalance: false };
  if (after === null) return { position: before + POSITION_STEP, needsRebalance: false };
  const gap = after - before;
  return { position: before + gap / 2, needsRebalance: !(gap > MIN_POSITION_GAP) };
}

export function sortCards<T extends BoardCard>(cards: T[]) {
  return [...cards].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/** Posições uniformes (1024, 2048, …) preservando a ordem atual. */
export function evenlySpaced<T extends BoardCard>(cards: T[]): T[] {
  return sortCards(cards).map((card, index) => ({ ...card, position: (index + 1) * POSITION_STEP }));
}

/**
 * Calcula onde o card cai ao soltar em `toIndex` da coluna de destino.
 * `toIndex` é o índice na coluna SEM o card arrastado (0 = topo).
 */
export function computeDropPosition<T extends BoardCard>(cards: T[], dealId: string, toStageId: string, toIndex: number) {
  const column = sortCards(cards.filter((card) => card.stageId === toStageId && card.id !== dealId));
  const index = Math.max(0, Math.min(Number.isFinite(toIndex) ? Math.trunc(toIndex) : column.length, column.length));
  const before = index > 0 ? column[index - 1].position : null;
  const after = index < column.length ? column[index].position : null;
  return { ...positionBetween(before, after), beforeId: column[index - 1]?.id ?? null, afterId: column[index]?.id ?? null };
}

/**
 * Aplica um movimento no estado do quadro (usado pela UI otimista e pelos testes).
 * Retorna o novo conjunto de cards e as linhas que precisam ser gravadas.
 */
export function applyMove<T extends BoardCard>(cards: T[], dealId: string, toStageId: string, toIndex: number) {
  const moving = cards.find((card) => card.id === dealId);
  if (!moving) return { cards, changed: [] as T[], fromStageId: null as string | null };
  const drop = computeDropPosition(cards, dealId, toStageId, toIndex);
  let next = cards.map((card) => (card.id === dealId ? { ...card, stageId: toStageId, position: drop.position } : card));
  let changed = next.filter((card) => card.id === dealId);

  if (drop.needsRebalance) {
    const column = evenlySpaced(next.filter((card) => card.stageId === toStageId));
    const byId = new Map(column.map((card) => [card.id, card]));
    next = next.map((card) => byId.get(card.id) ?? card);
    changed = column;
  }
  return { cards: next, changed, fromStageId: moving.stageId };
}

/** Distribui os cards nas colunas do pipeline, na ordem configurada. */
export function groupByStage<T extends BoardCard>(stages: PipelineStage[], cards: T[]) {
  const known = new Set(stages.map((stage) => stage.id));
  return sortStages(stages).map((stage) => ({
    stage,
    cards: sortCards(cards.filter((card) => card.stageId === stage.id))
  })).concat(
    // Defesa: um card com etapa desconhecida nunca desaparece silenciosamente.
    cards.some((card) => !known.has(card.stageId))
      ? [{ stage: { id: "__orphan__", name: "Sem etapa", kind: "open" as const, position: Number.MAX_SAFE_INTEGER }, cards: sortCards(cards.filter((card) => !known.has(card.stageId))) }]
      : []
  );
}

export function sumAmounts(cards: Array<{ amountCents: number | null }>) {
  return cards.reduce((total, card) => total + (card.amountCents ?? 0), 0);
}
