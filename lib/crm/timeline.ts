import { PRIORITY_LABEL, PROSPECT_ORIGIN_LABEL, isPriority, isProspectOrigin } from "./prospects";
import type { ActivityDraft, CrmActivity, Deal, DealSource, InteractionChannel } from "./types";

/**
 * Histórico do CRM. Toda mutação passa por um destes construtores, para que a
 * timeline registre sempre: o quê, quem (actor), quando (banco) e com quais valores.
 */

export const SOURCE_LABEL: Record<DealSource, string> = {
  manual: "Cadastro manual",
  search: "Resultado de busca",
  list: "Lista de prospecção",
  map: "Mapa empresarial",
  company: "Ficha da empresa",
  prospecting: "Central de prospecção"
};

export function isDealSource(value: unknown): value is DealSource {
  return typeof value === "string" && value in SOURCE_LABEL;
}

type Base = { dealId: string | null; establishmentId: string | null; prospectId?: string | null; actorProfileId: string };

export const INTERACTION_LABEL: Record<InteractionChannel, string> = {
  call: "Ligação",
  whatsapp: "WhatsApp",
  meeting: "Reunião",
  email: "E-mail",
  visit: "Visita",
  other: "Contato"
};

/** Forma usada no meio da frase (nomes próprios mantêm a grafia: WhatsApp). */
const INTERACTION_INLINE: Record<InteractionChannel, string> = {
  call: "ligação",
  whatsapp: "WhatsApp",
  meeting: "reunião",
  email: "e-mail",
  visit: "visita",
  other: "outro contato"
};

export const INTERACTION_OUTCOME_LABEL = {
  done: "realizado",
  no_answer: "sem resposta",
  scheduled: "reagendado"
} as const;

export type InteractionOutcome = keyof typeof INTERACTION_OUTCOME_LABEL;

export function isInteractionChannel(value: unknown): value is InteractionChannel {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INTERACTION_LABEL, value);
}

export function isInteractionOutcome(value: unknown): value is InteractionOutcome {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INTERACTION_OUTCOME_LABEL, value);
}

export function dealCreatedActivity(base: Base, input: { stageName: string; source: DealSource; sourceRef?: string | null; sourceLabel?: string | null }): ActivityDraft {
  return {
    ...base,
    type: "deal.created",
    payload: {
      stage: input.stageName,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      sourceLabel: input.sourceLabel ?? null
    }
  };
}

export type DealPatch = Partial<Pick<Deal, "title" | "amountCents" | "expectedCloseDate" | "lostReason" | "primaryContactId" | "priority">>;

const TRACKED_FIELDS: Array<keyof DealPatch> = ["title", "amountCents", "expectedCloseDate", "lostReason", "primaryContactId", "priority"];

/**
 * Compara o negócio antes/depois e produz as atividades correspondentes.
 * Campos inalterados não geram ruído na timeline.
 */
export function dealChangeActivities(
  base: Base,
  before: Pick<Deal, "stageId" | "ownerProfileId"> & DealPatch,
  after: Partial<Pick<Deal, "stageId" | "ownerProfileId">> & DealPatch,
  names: { stages: Map<string, string>; members: Map<string, string> }
): ActivityDraft[] {
  const drafts: ActivityDraft[] = [];

  if (after.stageId !== undefined && after.stageId !== before.stageId) {
    drafts.push({
      ...base,
      type: "stage.changed",
      payload: {
        fromStageId: before.stageId,
        toStageId: after.stageId,
        from: names.stages.get(before.stageId) ?? null,
        to: names.stages.get(after.stageId) ?? null
      }
    });
  }

  if (after.ownerProfileId !== undefined && after.ownerProfileId !== before.ownerProfileId) {
    drafts.push({
      ...base,
      type: "owner.changed",
      payload: {
        fromProfileId: before.ownerProfileId,
        toProfileId: after.ownerProfileId,
        from: before.ownerProfileId ? names.members.get(before.ownerProfileId) ?? null : null,
        to: after.ownerProfileId ? names.members.get(after.ownerProfileId) ?? null : null
      }
    });
  }

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of TRACKED_FIELDS) {
    if (after[field] === undefined) continue;
    const previous = before[field] ?? null;
    const next = after[field] ?? null;
    if (previous !== next) diff[field] = { from: previous, to: next };
  }
  if (Object.keys(diff).length) drafts.push({ ...base, type: "deal.updated", payload: { diff } });

  return drafts;
}

const FIELD_LABEL: Record<string, string> = {
  title: "título",
  amountCents: "valor",
  expectedCloseDate: "previsão de fechamento",
  lostReason: "motivo da perda",
  primaryContactId: "contato principal",
  priority: "prioridade"
};

const PROSPECT_FIELD_LABEL: Record<string, string> = {
  kind: "tipo",
  name: "nome",
  tradeName: "nome fantasia",
  document: "documento",
  origin: "origem",
  originDetail: "detalhe da origem",
  segment: "segmento",
  cityName: "cidade",
  stateCode: "UF",
  address: "endereço",
  contactName: "responsável",
  contactRole: "cargo",
  phone: "telefone",
  whatsapp: "WhatsApp",
  phoneSecondary: "telefone adicional",
  email: "e-mail",
  website: "site",
  tags: "tags"
};

function dateTimeLabel(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Frase curta para a timeline, sempre sem dados cadastrais copiados. */
export function describeActivity(activity: Pick<CrmActivity, "type" | "payload">): string {
  const p = activity.payload ?? {};
  switch (activity.type) {
    case "deal.created": {
      const source = isDealSource(p.source) ? SOURCE_LABEL[p.source] : "origem não informada";
      const label = text(p.sourceLabel);
      return `Entrou no CRM em “${text(p.stage) ?? "—"}” · origem: ${source}${label ? ` (${label})` : ""}`;
    }
    case "stage.changed":
      return `Etapa: ${text(p.from) ?? "—"} → ${text(p.to) ?? "—"}`;
    case "owner.changed":
      return p.toProfileId ? `Responsável: ${text(p.to) ?? "membro"}${p.fromProfileId ? ` (antes: ${text(p.from) ?? "membro"})` : ""}` : `Responsável removido${text(p.from) ? ` (era ${text(p.from)})` : ""}`;
    case "deal.updated": {
      const diff = (p.diff ?? {}) as Record<string, unknown>;
      const fields = Object.keys(diff).map((key) => FIELD_LABEL[key] ?? key);
      const priority = (diff.priority ?? null) as { to?: unknown } | null;
      if (fields.length === 1 && priority && isPriority(priority.to)) return `Prioridade: ${PRIORITY_LABEL[priority.to]}`;
      return fields.length ? `Atualizou ${fields.join(", ")}` : "Negócio atualizado";
    }
    case "deal.deleted":
      return p.kind === "prospect" ? "Negócio e cadastro manual do prospect removidos do CRM" : "Negócio removido do CRM (a empresa continua na base)";
    case "note.created":
      return "Adicionou uma nota";
    case "task.created":
      return `Criou a tarefa “${text(p.title) ?? "sem título"}”${text(p.dueAt) ? ` para ${new Date(String(p.dueAt)).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}`;
    case "task.completed":
      return `Concluiu a tarefa “${text(p.title) ?? "sem título"}”`;
    case "task.reopened":
      return `Reabriu a tarefa “${text(p.title) ?? "sem título"}”`;
    case "contact.created":
      return `Cadastrou o contato ${text(p.name) ?? ""}`.trim();
    case "contact.linked":
      return p.contactId ? `Definiu ${text(p.name) ?? "um contato"} como contato principal` : "Removeu o contato principal";
    case "contact.deleted":
      return `Excluiu o contato ${text(p.name) ?? ""}`.trim();
    case "prospect.created": {
      const origin = isProspectOrigin(p.origin) ? PROSPECT_ORIGIN_LABEL[p.origin] : "origem não informada";
      return `Cadastrou o prospect manualmente · origem: ${origin}${text(p.originDetail) ? ` (${text(p.originDetail)})` : ""}`;
    }
    case "prospect.updated": {
      const fields = Array.isArray(p.fields) ? p.fields.map((key) => PROSPECT_FIELD_LABEL[String(key)] ?? String(key)) : [];
      return fields.length ? `Editou o cadastro: ${fields.join(", ")}` : "Editou o cadastro do prospect";
    }
    case "interaction.logged": {
      const channel = isInteractionChannel(p.channel) ? INTERACTION_INLINE[p.channel] : "outro contato";
      const outcome = isInteractionOutcome(p.outcome) ? ` (${INTERACTION_OUTCOME_LABEL[p.outcome]})` : "";
      const when = dateTimeLabel(p.occurredAt);
      return `Registrou contato: ${channel}${outcome}${when ? ` · ${when}` : ""}${text(p.summary) ? ` — ${text(p.summary)}` : ""}`;
    }
    case "next_contact.scheduled": {
      const when = dateTimeLabel(p.at);
      return when ? `Agendou o próximo contato para ${when}` : "Removeu o próximo contato agendado";
    }
    default:
      return "Atividade";
  }
}

export type TimelineEntry =
  | { kind: "activity"; id: string; at: string; actorName: string | null; text: string; activityType: CrmActivity["type"] }
  | { kind: "note"; id: string; at: string; actorName: string | null; body: string };

/**
 * Timeline unificada (padrão de CRMs como o Twenty): eventos e notas em ordem
 * decrescente, agrupados por mês. A atividade "note.created" é omitida quando a
 * própria nota está presente, para não duplicar a linha.
 */
export function buildTimeline(
  activities: CrmActivity[],
  notes: Array<{ id: string; body: string; createdAt: string; authorName: string | null }>
) {
  const noteIds = new Set(notes.map((note) => note.id));
  const entries: TimelineEntry[] = [
    ...activities
      .filter((activity) => !(activity.type === "note.created" && noteIds.has(String(activity.payload?.noteId ?? ""))))
      .map((activity) => ({
        kind: "activity" as const,
        id: activity.id,
        at: activity.happenedAt,
        actorName: activity.actorName,
        text: describeActivity(activity),
        activityType: activity.type
      })),
    ...notes.map((note) => ({ kind: "note" as const, id: note.id, at: note.createdAt, actorName: note.authorName, body: note.body }))
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));

  const groups: Array<{ key: string; label: string; entries: TimelineEntry[] }> = [];
  for (const entry of entries) {
    const date = new Date(entry.at);
    const key = Number.isNaN(date.getTime()) ? "sem-data" : date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
    const raw = key === "sem-data" ? "Sem data" : date.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
    const label = raw.charAt(0).toLocaleUpperCase("pt-BR") + raw.slice(1);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, label, entries: [entry] });
  }
  return groups;
}
