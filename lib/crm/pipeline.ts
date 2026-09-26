import type { PipelineStage, StageKind } from "./types";

/** Pipeline padrão criado para todo workspace novo. Editável depois. */
export const DEFAULT_PIPELINE: ReadonlyArray<{ name: string; kind: StageKind }> = [
  { name: "Novo", kind: "open" },
  { name: "Contato realizado", kind: "open" },
  { name: "Interessado", kind: "open" },
  { name: "Reunião", kind: "open" },
  { name: "Proposta", kind: "open" },
  { name: "Ganho", kind: "won" },
  { name: "Perdido", kind: "lost" }
];

export const MAX_STAGES = 12;
export const STAGE_NAME_MAX = 60;

export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  open: "Em andamento",
  won: "Ganho",
  lost: "Perdido"
};

export function isStageKind(value: unknown): value is StageKind {
  return value === "open" || value === "won" || value === "lost";
}

export function cleanStageName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, STAGE_NAME_MAX);
}

export function sortStages<T extends Pick<PipelineStage, "position" | "name">>(stages: T[]) {
  return [...stages].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"));
}

/** Primeira etapa aberta: destino de empresas que entram no CRM. */
export function entryStage(stages: PipelineStage[]) {
  const ordered = sortStages(stages);
  return ordered.find((stage) => stage.kind === "open") ?? ordered[0] ?? null;
}

export function isClosedStage(stage: Pick<PipelineStage, "kind"> | null | undefined) {
  return stage?.kind === "won" || stage?.kind === "lost";
}

export type PipelineDraft = Array<{ id?: string; name: string; kind: StageKind }>;

/**
 * Valida uma configuração de pipeline antes de persistir. Retorna mensagens em
 * português prontas para a interface; lista vazia = válido.
 */
export function validatePipeline(stages: PipelineDraft): string[] {
  const errors: string[] = [];
  if (stages.length === 0) errors.push("O pipeline precisa de pelo menos uma etapa.");
  if (stages.length > MAX_STAGES) errors.push(`Use no máximo ${MAX_STAGES} etapas.`);
  if (!stages.some((stage) => stage.kind === "open")) errors.push("Mantenha ao menos uma etapa em andamento.");

  const seen = new Set<string>();
  for (const stage of stages) {
    const name = cleanStageName(stage.name);
    if (!name) {
      errors.push("Toda etapa precisa de um nome.");
      continue;
    }
    const key = name.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) errors.push(`Etapa duplicada: ${name}.`);
    seen.add(key);
    if (!isStageKind(stage.kind)) errors.push(`Tipo inválido na etapa ${name}.`);
  }
  if (stages.filter((stage) => stage.kind === "won").length > 1) errors.push("Use apenas uma etapa de ganho.");
  if (stages.filter((stage) => stage.kind === "lost").length > 1) errors.push("Use apenas uma etapa de perda.");
  return Array.from(new Set(errors));
}

/**
 * Reordena uma etapa uma posição acima/abaixo e devolve as novas posições 0..n-1.
 * Posições inteiras e densas: o pipeline é pequeno, então renumerar tudo é trivial.
 */
export function moveStage<T extends PipelineStage>(stages: T[], stageId: string, direction: "up" | "down"): T[] {
  const ordered = sortStages(stages);
  const index = ordered.findIndex((stage) => stage.id === stageId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ordered.length) return ordered.map((stage, position) => ({ ...stage, position }));
  const next = [...ordered];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((stage, position) => ({ ...stage, position }));
}

/**
 * Plano para excluir uma etapa. Negócios nela precisam de destino, e a etapa
 * restante deve continuar formando um pipeline válido.
 */
export function planStageRemoval(stages: PipelineStage[], stageId: string, dealCount: number, fallbackStageId?: string | null) {
  const remaining = stages.filter((stage) => stage.id !== stageId);
  if (remaining.length === stages.length) return { ok: false as const, error: "Etapa não encontrada." };
  const errors = validatePipeline(remaining);
  if (errors.length) return { ok: false as const, error: errors[0] };
  if (dealCount === 0) return { ok: true as const, moveDealsTo: null };
  const destination = remaining.find((stage) => stage.id === fallbackStageId) ?? null;
  if (!destination) return { ok: false as const, error: "Escolha para qual etapa mover os negócios desta etapa." };
  return { ok: true as const, moveDealsTo: destination.id };
}

/** Efeitos de uma troca de etapa (fechamento/reabertura). */
export function stageTransition(from: Pick<PipelineStage, "kind"> | null, to: Pick<PipelineStage, "kind">, now: string) {
  const closing = isClosedStage(to);
  return {
    closedAt: closing ? (isClosedStage(from) && from?.kind === to.kind ? undefined : now) : null,
    clearLostReason: to.kind !== "lost"
  };
}
