import { sql } from "@/lib/db";
import { applyMove, POSITION_STEP } from "./board";
import { DEFAULT_PIPELINE, cleanStageName, entryStage, isClosedStage, moveStage, planStageRemoval, sortStages, stageTransition, validatePipeline } from "./pipeline";
import {
  canAddActivity,
  canAssignDeal,
  canChangeMember,
  canConfigurePipeline,
  canDeleteDeal,
  canEditDeal,
  canManageContacts,
  canManageMembers,
  canMoveDeal,
  canUpdateTask,
  isCrmRole
} from "./permissions";
import { dealChangeActivities, dealCreatedActivity, type DealPatch } from "./timeline";
import { isUuid, planImport } from "./input";
import type {
  ActivityDraft,
  CrmActivity,
  CrmContact,
  CrmContext,
  CrmMember,
  CrmNote,
  CrmRole,
  CrmTask,
  CrmWorkspace,
  DealSource,
  DealView,
  PipelineStage,
  StageKind
} from "./types";

/**
 * Acesso a dados do CRM (somente servidor: usa lib/db e DATABASE_URL; as páginas e
 * actions o importam via lib/crm/server.ts ou server components).
 *
 * REGRA DE ISOLAMENTO: toda função recebe um `CrmContext`, que só é criado por
 * `resolveCrmContext` depois de confirmar a associação do usuário ao workspace.
 * Toda consulta filtra por `workspace_id = ctx.workspace.id`. Ids recebidos do
 * cliente nunca são usados sem esse filtro.
 */

type Row = Record<string, unknown>;

export class CrmError extends Error {
  constructor(public readonly code: "forbidden" | "not_found" | "invalid" | "conflict", message: string) {
    super(message);
  }
}

async function q(text: string, params: unknown[] = []) {
  return (await sql.query(text, params)) as Row[];
}

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const strOrNull = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : strOrNull(value));
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = strOrNull(value);
  return text ? text.slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Workspace / contexto
// ---------------------------------------------------------------------------

const DISPLAY_NAME = "COALESCE(NULLIF(p.full_name, ''), NULLIF(u.name, ''), p.email, u.email, 'Usuário')";

function seedStagesSql(workspaceRef: string) {
  const values = DEFAULT_PIPELINE.map((stage, index) => `('${stage.name.replace(/'/g, "''")}', '${stage.kind}', ${index})`).join(", ");
  return `INSERT INTO crm_pipeline_stages (workspace_id, name, kind, position)
          SELECT ${workspaceRef}.id, v.name, v.kind, v.position FROM ${workspaceRef} CROSS JOIN (VALUES ${values}) AS v(name, kind, position)`;
}

/** Cria (uma única vez, atomicamente) o workspace pessoal com pipeline padrão. */
async function ensurePersonalWorkspace(profileId: string, displayName: string) {
  await q(
    `WITH ws AS (
       INSERT INTO crm_workspaces (name, owner_profile_id, is_personal)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (owner_profile_id) WHERE is_personal DO NOTHING
       RETURNING id
     ), member AS (
       INSERT INTO crm_workspace_members (workspace_id, profile_id, role)
       SELECT id, $2, 'owner' FROM ws
     ), stages AS (${seedStagesSql("ws")})
     SELECT id FROM ws`,
    [displayName, profileId]
  );
}

function mapWorkspace(row: Row): CrmWorkspace {
  return { id: str(row.id), name: str(row.name), isPersonal: Boolean(row.is_personal), ownerProfileId: str(row.owner_profile_id) };
}

export async function listMyWorkspaces(profileId: string) {
  const rows = await q(
    `SELECT w.id, w.name, w.is_personal, w.owner_profile_id, m.role
       FROM crm_workspace_members m
       JOIN crm_workspaces w ON w.id = m.workspace_id
      WHERE m.profile_id = $1
      ORDER BY w.is_personal DESC, w.name ASC`,
    [profileId]
  );
  return rows.map((row) => ({ ...mapWorkspace(row), role: (isCrmRole(row.role) ? row.role : "member") as CrmRole }));
}

/**
 * Resolve o workspace ativo do usuário. `preferredId` (cookie/URL) só é aceito se
 * o usuário for membro; caso contrário cai no workspace pessoal.
 */
export async function resolveCrmContext(user: { id: string; email: string; name?: string | null }, preferredId?: string | null) {
  let workspaces = await listMyWorkspaces(user.id);
  if (!workspaces.some((workspace) => workspace.isPersonal && workspace.ownerProfileId === user.id)) {
    await ensurePersonalWorkspace(user.id, "Meu CRM");
    workspaces = await listMyWorkspaces(user.id);
  }
  const active =
    workspaces.find((workspace) => preferredId && workspace.id === preferredId) ??
    workspaces.find((workspace) => workspace.isPersonal) ??
    workspaces[0];
  if (!active) throw new CrmError("not_found", "Não foi possível abrir o CRM.");

  const ctx: CrmContext = { workspace: active, profileId: user.id, role: active.role };
  return { ctx, workspaces };
}

export async function listMembers(ctx: CrmContext): Promise<CrmMember[]> {
  const rows = await q(
    `SELECT m.profile_id, m.role, ${DISPLAY_NAME} AS name, COALESCE(p.email, u.email, '') AS email
       FROM crm_workspace_members m
       JOIN profiles p ON p.id = m.profile_id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE m.workspace_id = $1
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name`,
    [ctx.workspace.id]
  );
  return rows.map((row) => ({ profileId: str(row.profile_id), role: (isCrmRole(row.role) ? row.role : "member") as CrmRole, name: str(row.name), email: str(row.email) }));
}

export async function listStages(ctx: CrmContext): Promise<PipelineStage[]> {
  const rows = await q(`SELECT id, name, kind, position FROM crm_pipeline_stages WHERE workspace_id = $1 ORDER BY position, name`, [ctx.workspace.id]);
  return rows.map((row) => ({ id: str(row.id), name: str(row.name), kind: str(row.kind) as StageKind, position: Number(row.position ?? 0) }));
}

// ---------------------------------------------------------------------------
// Negócios
// ---------------------------------------------------------------------------

const DEAL_SELECT = `
  SELECT d.*, e.cnpj, e.company_name, e.trade_name, e.city_name, e.state_code,
         ${DISPLAY_NAME} AS owner_name, t.open_tasks, t.next_due
    FROM crm_deals d
    JOIN establishments e ON e.id = d.establishment_id
    LEFT JOIN profiles p ON p.id = d.owner_profile_id
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS open_tasks, min(due_at) AS next_due
        FROM crm_tasks ct
       WHERE ct.workspace_id = d.workspace_id AND ct.deal_id = d.id AND ct.status = 'todo'
    ) t ON TRUE`;

function mapDeal(row: Row): DealView {
  return {
    id: str(row.id),
    establishmentId: str(row.establishment_id),
    stageId: str(row.stage_id),
    position: Number(row.position ?? 0),
    title: strOrNull(row.title),
    ownerProfileId: strOrNull(row.owner_profile_id),
    primaryContactId: strOrNull(row.primary_contact_id),
    amountCents: num(row.amount_cents),
    expectedCloseDate: dateOnly(row.expected_close_date),
    source: (str(row.source) || "manual") as DealSource,
    sourceRef: strOrNull(row.source_ref),
    lostReason: strOrNull(row.lost_reason),
    closedAt: iso(row.closed_at),
    createdBy: strOrNull(row.created_by),
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    ownerName: row.owner_profile_id ? str(row.owner_name) : null,
    openTasks: Number(row.open_tasks ?? 0),
    nextTaskDueAt: iso(row.next_due),
    company: {
      establishmentId: str(row.establishment_id),
      cnpj: str(row.cnpj),
      companyName: str(row.company_name) || "Empresa sem razão social",
      tradeName: str(row.trade_name),
      cityName: str(row.city_name),
      stateCode: str(row.state_code)
    }
  };
}

export type DealFilters = { owner?: "me" | "none" | string; q?: string; source?: DealSource | ""; stageId?: string };

export async function listDeals(ctx: CrmContext, filters: DealFilters = {}, limit = 2000) {
  const params: unknown[] = [ctx.workspace.id];
  const where = ["d.workspace_id = $1"];
  if (filters.owner === "me") {
    params.push(ctx.profileId);
    where.push(`d.owner_profile_id = $${params.length}`);
  } else if (filters.owner === "none") {
    where.push("d.owner_profile_id IS NULL");
  } else if (filters.owner && isUuid(filters.owner)) {
    params.push(filters.owner);
    where.push(`d.owner_profile_id = $${params.length}`);
  }
  if (filters.stageId && isUuid(filters.stageId)) {
    params.push(filters.stageId);
    where.push(`d.stage_id = $${params.length}`);
  }
  if (filters.source) {
    params.push(filters.source);
    where.push(`d.source = $${params.length}`);
  }
  const term = (filters.q ?? "").trim().slice(0, 80);
  if (term) {
    params.push(`%${term.replace(/[%_\\]/g, (match) => `\\${match}`)}%`);
    const like = `$${params.length}`;
    const clauses = [`e.company_name ILIKE ${like}`, `e.trade_name ILIKE ${like}`, `e.city_name ILIKE ${like}`, `d.title ILIKE ${like}`];
    const digits = term.replace(/\D/g, "");
    if (digits.length >= 4) {
      params.push(`%${digits}%`);
      clauses.push(`e.cnpj LIKE $${params.length}`);
    }
    where.push(`(${clauses.join(" OR ")})`);
  }
  params.push(Math.max(1, Math.min(limit, 5000)));
  const rows = await q(`${DEAL_SELECT} WHERE ${where.join(" AND ")} ORDER BY d.position ASC, d.id ASC LIMIT $${params.length}`, params);
  return rows.map(mapDeal);
}

export async function getDeal(ctx: CrmContext, dealId: string) {
  if (!isUuid(dealId)) return null;
  const rows = await q(`${DEAL_SELECT} WHERE d.workspace_id = $1 AND d.id = $2`, [ctx.workspace.id, dealId]);
  return rows[0] ? mapDeal(rows[0]) : null;
}

export async function getDealByEstablishment(ctx: CrmContext, establishmentId: string) {
  if (!isUuid(establishmentId)) return null;
  const rows = await q(`${DEAL_SELECT} WHERE d.workspace_id = $1 AND d.establishment_id = $2`, [ctx.workspace.id, establishmentId]);
  return rows[0] ? mapDeal(rows[0]) : null;
}

/** Negócios existentes por empresa — usado para marcar "no CRM" em listas. */
export async function dealIdsByEstablishment(ctx: CrmContext, establishmentIds: string[]) {
  const ids = establishmentIds.filter(isUuid);
  if (!ids.length) return new Map<string, string>();
  const rows = await q(`SELECT id, establishment_id FROM crm_deals WHERE workspace_id = $1 AND establishment_id = ANY($2::uuid[])`, [ctx.workspace.id, ids]);
  return new Map(rows.map((row) => [str(row.establishment_id), str(row.id)]));
}

function activityInsert(ctx: CrmContext, draft: ActivityDraft) {
  return {
    text: `INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, actor_profile_id, type, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    params: [ctx.workspace.id, draft.dealId, draft.establishmentId, draft.actorProfileId, draft.type, JSON.stringify(draft.payload)]
  };
}

/**
 * Empresas → CRM (1 ou N). Referencia `establishments.id`; não copia dados.
 * Ignora empresas que já têm negócio no workspace. Tudo em uma instrução atômica:
 * negócios e registros de histórico nascem juntos.
 */
export async function createDeals(
  ctx: CrmContext,
  establishmentIds: string[],
  options: { source: DealSource; sourceRef?: string | null; sourceLabel?: string | null; ownerProfileId?: string | null; stageId?: string | null }
) {
  const stages = await listStages(ctx);
  const stage = (options.stageId && stages.find((item) => item.id === options.stageId)) || entryStage(stages);
  if (!stage) throw new CrmError("invalid", "Configure ao menos uma etapa no pipeline.");

  const existing = await dealIdsByEstablishment(ctx, establishmentIds);
  const plan = planImport(establishmentIds, existing.keys());
  if (!plan.toCreate.length) return { created: 0, alreadyInCrm: plan.alreadyInCrm, requested: plan.requested, dealIds: [] as string[] };

  let ownerId: string | null = options.ownerProfileId ?? null;
  if (ownerId) {
    const members = await listMembers(ctx);
    if (!members.some((member) => member.profileId === ownerId)) ownerId = null;
  }
  const payload = dealCreatedActivity({ dealId: null, establishmentId: null, actorProfileId: ctx.profileId }, {
    stageName: stage.name,
    source: options.source,
    sourceRef: options.sourceRef ?? null,
    sourceLabel: options.sourceLabel ?? null
  }).payload;

  const rows = await q(
    `WITH input AS (
       SELECT e.id AS establishment_id, i.ord
         FROM unnest($4::uuid[]) WITH ORDINALITY AS i(id, ord)
         JOIN establishments e ON e.id = i.id
     ), base AS (
       SELECT COALESCE(MIN(position), ${POSITION_STEP}) AS top FROM crm_deals WHERE workspace_id = $1 AND stage_id = $2
     ), ins AS (
       INSERT INTO crm_deals (workspace_id, establishment_id, stage_id, position, owner_profile_id, source, source_ref, created_by)
       SELECT $1, input.establishment_id, $2, base.top - input.ord * ${POSITION_STEP}, $3, $5, $6, $7
         FROM input CROSS JOIN base
       ON CONFLICT (workspace_id, establishment_id) DO NOTHING
       RETURNING id, establishment_id
     ), act AS (
       INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, actor_profile_id, type, payload)
       SELECT $1, ins.id, ins.establishment_id, $7, 'deal.created', $8::jsonb FROM ins
     )
     SELECT id FROM ins`,
    [ctx.workspace.id, stage.id, ownerId, plan.toCreate, options.source, options.sourceRef ?? null, ctx.profileId, JSON.stringify(payload)]
  );
  return { created: rows.length, alreadyInCrm: plan.requested - rows.length, requested: plan.requested, dealIds: rows.map((row) => str(row.id)) };
}

async function requireDeal(ctx: CrmContext, dealId: string) {
  const deal = await getDeal(ctx, dealId);
  if (!deal) throw new CrmError("not_found", "Negócio não encontrado neste workspace.");
  return deal;
}

export async function updateDeal(ctx: CrmContext, dealId: string, patch: DealPatch & { ownerProfileId?: string | null; stageId?: string }) {
  const deal = await requireDeal(ctx, dealId);
  const actor = { profileId: ctx.profileId, role: ctx.role };
  const [stages, members] = await Promise.all([listStages(ctx), listMembers(ctx)]);
  const memberIds = new Set(members.map((member) => member.profileId));

  const changesOwner = patch.ownerProfileId !== undefined && patch.ownerProfileId !== deal.ownerProfileId;
  const otherChanges = Object.entries(patch).some(([key, value]) => key !== "ownerProfileId" && value !== undefined);
  if (changesOwner && !canAssignDeal(actor, deal, patch.ownerProfileId ?? null, memberIds)) {
    throw new CrmError("forbidden", "Você não pode alterar o responsável deste negócio.");
  }
  if (otherChanges && !canEditDeal(actor, deal)) throw new CrmError("forbidden", "Somente o responsável ou um administrador pode editar este negócio.");

  const nextStage = patch.stageId ? stages.find((stage) => stage.id === patch.stageId) : undefined;
  if (patch.stageId && !nextStage) throw new CrmError("invalid", "Etapa inválida.");
  const currentStage = stages.find((stage) => stage.id === deal.stageId) ?? null;

  const sets: string[] = [];
  const params: unknown[] = [ctx.workspace.id, dealId];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.title !== undefined) set("title", patch.title);
  if (patch.amountCents !== undefined) set("amount_cents", patch.amountCents);
  if (patch.expectedCloseDate !== undefined) set("expected_close_date", patch.expectedCloseDate);
  if (patch.lostReason !== undefined) set("lost_reason", patch.lostReason);
  if (patch.primaryContactId !== undefined) {
    if (patch.primaryContactId) {
      const contact = await q(`SELECT id FROM crm_contacts WHERE workspace_id = $1 AND id = $2 AND establishment_id = $3`, [ctx.workspace.id, patch.primaryContactId, deal.establishmentId]);
      if (!contact.length) throw new CrmError("invalid", "Contato inválido para esta empresa.");
    }
    set("primary_contact_id", patch.primaryContactId);
  }
  if (changesOwner) set("owner_profile_id", patch.ownerProfileId ?? null);
  if (nextStage && nextStage.id !== deal.stageId) {
    const now = new Date().toISOString();
    const transition = stageTransition(currentStage, nextStage, now);
    set("stage_id", nextStage.id);
    if (transition.closedAt !== undefined) set("closed_at", transition.closedAt);
    if (transition.clearLostReason && patch.lostReason === undefined) set("lost_reason", null);
    // Entra no topo da nova coluna.
    const [top] = await q(`SELECT MIN(position) AS top FROM crm_deals WHERE workspace_id = $1 AND stage_id = $2`, [ctx.workspace.id, nextStage.id]);
    set("position", (top?.top === null || top?.top === undefined ? POSITION_STEP : Number(top.top)) - POSITION_STEP);
  }
  if (!sets.length) return deal;
  sets.push("updated_at = NOW()");

  const drafts = dealChangeActivities(
    { dealId, establishmentId: deal.establishmentId, actorProfileId: ctx.profileId },
    deal,
    { ...patch, ownerProfileId: changesOwner ? patch.ownerProfileId ?? null : undefined, stageId: nextStage?.id },
    { stages: new Map(stages.map((stage) => [stage.id, stage.name])), members: new Map(members.map((member) => [member.profileId, member.name])) }
  );
  await sql.transaction([
    { text: `UPDATE crm_deals SET ${sets.join(", ")} WHERE workspace_id = $1 AND id = $2`, params },
    ...drafts.map((draft) => activityInsert(ctx, draft))
  ]);
  return requireDeal(ctx, dealId);
}

/**
 * Drag & drop do Kanban. O servidor recalcula a posição a partir do estado atual
 * da coluna (não confia em posições enviadas pelo cliente).
 */
export async function moveDeal(ctx: CrmContext, dealId: string, toStageId: string, toIndex: number) {
  const deal = await requireDeal(ctx, dealId);
  if (!canMoveDeal({ profileId: ctx.profileId, role: ctx.role }, deal)) {
    throw new CrmError("forbidden", "Somente o responsável ou um administrador pode mover este negócio.");
  }
  const stages = await listStages(ctx);
  const target = stages.find((stage) => stage.id === toStageId);
  if (!target) throw new CrmError("invalid", "Etapa inválida.");
  const from = stages.find((stage) => stage.id === deal.stageId) ?? null;

  const column = await q(`SELECT id, stage_id, position FROM crm_deals WHERE workspace_id = $1 AND (stage_id = $2 OR id = $3)`, [ctx.workspace.id, toStageId, dealId]);
  const cards = column.map((row) => ({ id: str(row.id), stageId: str(row.stage_id), position: Number(row.position) }));
  const result = applyMove(cards, dealId, toStageId, toIndex);

  const statements: Array<{ text: string; params: unknown[] }> = result.changed.map((card) => ({
    text: `UPDATE crm_deals SET position = $3, updated_at = CASE WHEN id = $4 THEN NOW() ELSE updated_at END WHERE workspace_id = $1 AND id = $2`,
    params: [ctx.workspace.id, card.id, card.position, dealId]
  }));
  if (toStageId !== deal.stageId) {
    const transition = stageTransition(from, target, new Date().toISOString());
    statements.push({
      text: `UPDATE crm_deals SET stage_id = $3, closed_at = CASE WHEN $4::boolean THEN closed_at ELSE $5::timestamptz END,
                    lost_reason = CASE WHEN $6::boolean THEN NULL ELSE lost_reason END, updated_at = NOW()
              WHERE workspace_id = $1 AND id = $2`,
      params: [ctx.workspace.id, dealId, toStageId, transition.closedAt === undefined, transition.closedAt ?? null, transition.clearLostReason]
    });
    statements.push(activityInsert(ctx, {
      type: "stage.changed",
      dealId,
      establishmentId: deal.establishmentId,
      actorProfileId: ctx.profileId,
      payload: { fromStageId: deal.stageId, toStageId, from: from?.name ?? null, to: target.name, via: "board" }
    }));
  }
  await sql.transaction(statements);
  return { stageChanged: toStageId !== deal.stageId, closed: isClosedStage(target) };
}

export async function deleteDeal(ctx: CrmContext, dealId: string) {
  const deal = await requireDeal(ctx, dealId);
  if (!canDeleteDeal({ profileId: ctx.profileId, role: ctx.role }, deal)) {
    throw new CrmError("forbidden", "Somente quem criou o negócio (sendo responsável) ou um administrador pode removê-lo.");
  }
  await sql.transaction([
    activityInsert(ctx, { type: "deal.deleted", dealId, establishmentId: deal.establishmentId, actorProfileId: ctx.profileId, payload: {} }),
    { text: `DELETE FROM crm_deals WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, dealId] }
  ]);
}

// ---------------------------------------------------------------------------
// Notas, tarefas, contatos, histórico
// ---------------------------------------------------------------------------

export async function listNotes(ctx: CrmContext, dealId: string): Promise<CrmNote[]> {
  const rows = await q(
    `SELECT n.id, n.deal_id, n.body, n.author_profile_id, n.created_at, ${DISPLAY_NAME} AS author_name
       FROM crm_notes n LEFT JOIN profiles p ON p.id = n.author_profile_id LEFT JOIN users u ON u.id = p.user_id
      WHERE n.workspace_id = $1 AND n.deal_id = $2 ORDER BY n.created_at DESC LIMIT 500`,
    [ctx.workspace.id, dealId]
  );
  return rows.map((row) => ({ id: str(row.id), dealId: str(row.deal_id), body: str(row.body), authorProfileId: strOrNull(row.author_profile_id), authorName: row.author_profile_id ? str(row.author_name) : null, createdAt: iso(row.created_at) ?? "" }));
}

export async function addNote(ctx: CrmContext, dealId: string, body: string) {
  const deal = await requireDeal(ctx, dealId);
  if (!canAddActivity({ profileId: ctx.profileId, role: ctx.role })) throw new CrmError("forbidden", "Sem permissão.");
  await q(
    `WITH n AS (
       INSERT INTO crm_notes (workspace_id, deal_id, body, author_profile_id) VALUES ($1, $2, $3, $4) RETURNING id
     )
     INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, actor_profile_id, type, payload)
     SELECT $1, $2, $5, $4, 'note.created', jsonb_build_object('noteId', n.id) FROM n`,
    [ctx.workspace.id, dealId, body, ctx.profileId, deal.establishmentId]
  );
}

function mapTask(row: Row): CrmTask {
  return {
    id: str(row.id),
    dealId: str(row.deal_id),
    title: str(row.title),
    dueAt: iso(row.due_at),
    status: row.status === "done" ? "done" : "todo",
    assigneeProfileId: strOrNull(row.assignee_profile_id),
    assigneeName: row.assignee_profile_id ? str(row.assignee_name) : null,
    createdBy: strOrNull(row.created_by),
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at) ?? ""
  };
}

export async function listTasks(ctx: CrmContext, filter: { dealId?: string; assigneeId?: string; openOnly?: boolean } = {}) {
  const params: unknown[] = [ctx.workspace.id];
  const where = ["t.workspace_id = $1"];
  if (filter.dealId) {
    params.push(filter.dealId);
    where.push(`t.deal_id = $${params.length}`);
  }
  if (filter.assigneeId) {
    params.push(filter.assigneeId);
    where.push(`t.assignee_profile_id = $${params.length}`);
  }
  if (filter.openOnly) where.push("t.status = 'todo'");
  const rows = await q(
    `SELECT t.*, ${DISPLAY_NAME} AS assignee_name
       FROM crm_tasks t LEFT JOIN profiles p ON p.id = t.assignee_profile_id LEFT JOIN users u ON u.id = p.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY (t.status = 'done'), t.due_at NULLS LAST, t.created_at DESC LIMIT 500`,
    params
  );
  return rows.map(mapTask);
}

export async function addTask(ctx: CrmContext, dealId: string, input: { title: string; dueAt: string | null; assigneeProfileId: string | null }) {
  const deal = await requireDeal(ctx, dealId);
  let assignee = input.assigneeProfileId;
  if (assignee) {
    const members = await listMembers(ctx);
    if (!members.some((member) => member.profileId === assignee)) throw new CrmError("invalid", "O responsável da tarefa precisa ser membro do workspace.");
  } else {
    assignee = ctx.profileId;
  }
  await q(
    `WITH t AS (
       INSERT INTO crm_tasks (workspace_id, deal_id, title, due_at, assignee_profile_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
     )
     INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, actor_profile_id, type, payload)
     SELECT $1, $2, $7, $6, 'task.created', $8::jsonb || jsonb_build_object('taskId', t.id) FROM t`,
    [ctx.workspace.id, dealId, input.title, input.dueAt, assignee, ctx.profileId, deal.establishmentId, JSON.stringify({ title: input.title, dueAt: input.dueAt, assigneeId: assignee })]
  );
}

export async function setTaskStatus(ctx: CrmContext, taskId: string, done: boolean) {
  if (!isUuid(taskId)) throw new CrmError("invalid", "Tarefa inválida.");
  const rows = await q(`SELECT * FROM crm_tasks WHERE workspace_id = $1 AND id = $2`, [ctx.workspace.id, taskId]);
  const task = rows[0] ? mapTask(rows[0]) : null;
  if (!task) throw new CrmError("not_found", "Tarefa não encontrada.");
  const deal = await requireDeal(ctx, task.dealId);
  if (!canUpdateTask({ profileId: ctx.profileId, role: ctx.role }, task, deal)) throw new CrmError("forbidden", "Somente o responsável pela tarefa, pelo negócio ou um administrador pode alterá-la.");
  if ((task.status === "done") === done) return;
  await sql.transaction([
    {
      text: `UPDATE crm_tasks SET status = $3, completed_at = ${done ? "NOW()" : "NULL"}, updated_at = NOW() WHERE workspace_id = $1 AND id = $2`,
      params: [ctx.workspace.id, taskId, done ? "done" : "todo"]
    },
    activityInsert(ctx, { type: done ? "task.completed" : "task.reopened", dealId: task.dealId, establishmentId: deal.establishmentId, actorProfileId: ctx.profileId, payload: { taskId, title: task.title } })
  ]);
}

export async function listContacts(ctx: CrmContext, establishmentId: string): Promise<CrmContact[]> {
  const rows = await q(`SELECT * FROM crm_contacts WHERE workspace_id = $1 AND establishment_id = $2 ORDER BY name`, [ctx.workspace.id, establishmentId]);
  return rows.map((row) => ({ id: str(row.id), establishmentId: str(row.establishment_id), name: str(row.name), jobTitle: strOrNull(row.job_title), email: strOrNull(row.email), phone: strOrNull(row.phone), createdAt: iso(row.created_at) ?? "" }));
}

export async function addContact(ctx: CrmContext, dealId: string, input: { name: string; jobTitle: string | null; email: string | null; phone: string | null; makePrimary: boolean }) {
  const deal = await requireDeal(ctx, dealId);
  if (!canManageContacts({ profileId: ctx.profileId, role: ctx.role })) throw new CrmError("forbidden", "Sem permissão.");
  const setPrimary = input.makePrimary && canEditDeal({ profileId: ctx.profileId, role: ctx.role }, deal);
  // Nome do contato no histórico: é dado inserido pelo próprio usuário, necessário para a trilha.
  await q(
    `WITH c AS (
       INSERT INTO crm_contacts (workspace_id, establishment_id, name, job_title, email, phone, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
     ), primary_link AS (
       UPDATE crm_deals SET primary_contact_id = c.id, updated_at = NOW() FROM c
        WHERE $9::boolean AND crm_deals.workspace_id = $1 AND crm_deals.id = $8
     )
     INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, actor_profile_id, type, payload)
     SELECT $1, $8, $2, $7, 'contact.created', jsonb_build_object('contactId', c.id, 'name', $3::text, 'primary', $9::boolean) FROM c`,
    [ctx.workspace.id, deal.establishmentId, input.name, input.jobTitle, input.email, input.phone, ctx.profileId, dealId, setPrimary]
  );
}

export async function deleteContact(ctx: CrmContext, dealId: string, contactId: string) {
  const deal = await requireDeal(ctx, dealId);
  if (!canEditDeal({ profileId: ctx.profileId, role: ctx.role }, deal)) throw new CrmError("forbidden", "Somente o responsável ou um administrador pode excluir contatos.");
  const rows = await q(`SELECT name FROM crm_contacts WHERE workspace_id = $1 AND id = $2 AND establishment_id = $3`, [ctx.workspace.id, contactId, deal.establishmentId]);
  if (!rows.length) throw new CrmError("not_found", "Contato não encontrado.");
  await sql.transaction([
    activityInsert(ctx, { type: "contact.deleted", dealId, establishmentId: deal.establishmentId, actorProfileId: ctx.profileId, payload: { contactId, name: str(rows[0].name) } }),
    { text: `DELETE FROM crm_contacts WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, contactId] }
  ]);
}

export async function listActivities(ctx: CrmContext, filter: { dealId?: string; establishmentId?: string }, limit = 300): Promise<CrmActivity[]> {
  const params: unknown[] = [ctx.workspace.id];
  const where = ["a.workspace_id = $1"];
  if (filter.dealId) {
    params.push(filter.dealId);
    where.push(`a.deal_id = $${params.length}`);
  }
  if (filter.establishmentId) {
    params.push(filter.establishmentId);
    where.push(`a.establishment_id = $${params.length}`);
  }
  params.push(limit);
  const rows = await q(
    `SELECT a.*, ${DISPLAY_NAME} AS actor_name
       FROM crm_activities a LEFT JOIN profiles p ON p.id = a.actor_profile_id LEFT JOIN users u ON u.id = p.user_id
      WHERE ${where.join(" AND ")} ORDER BY a.happened_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => ({
    id: str(row.id),
    dealId: strOrNull(row.deal_id),
    establishmentId: strOrNull(row.establishment_id),
    actorProfileId: strOrNull(row.actor_profile_id),
    actorName: row.actor_profile_id ? str(row.actor_name) : null,
    type: str(row.type) as CrmActivity["type"],
    payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
    happenedAt: iso(row.happened_at) ?? ""
  }));
}

// ---------------------------------------------------------------------------
// Pipeline (configuração)
// ---------------------------------------------------------------------------

function requirePipelineAdmin(ctx: CrmContext) {
  if (!canConfigurePipeline({ profileId: ctx.profileId, role: ctx.role })) throw new CrmError("forbidden", "Somente proprietário ou administrador configura o pipeline.");
}

export async function saveStage(ctx: CrmContext, stageId: string, input: { name: string; kind: StageKind }) {
  requirePipelineAdmin(ctx);
  const stages = await listStages(ctx);
  if (!stages.some((stage) => stage.id === stageId)) throw new CrmError("not_found", "Etapa não encontrada.");
  const next = stages.map((stage) => (stage.id === stageId ? { ...stage, name: cleanStageName(input.name), kind: input.kind } : stage));
  const errors = validatePipeline(next);
  if (errors.length) throw new CrmError("invalid", errors[0]);
  await q(`UPDATE crm_pipeline_stages SET name = $3, kind = $4, updated_at = NOW() WHERE workspace_id = $1 AND id = $2`, [ctx.workspace.id, stageId, cleanStageName(input.name), input.kind]);
}

export async function addStage(ctx: CrmContext, input: { name: string; kind: StageKind }) {
  requirePipelineAdmin(ctx);
  const stages = sortStages(await listStages(ctx));
  const name = cleanStageName(input.name);
  // Etapas abertas entram antes das de fechamento; ganho/perda vão para o fim.
  const firstClosed = stages.findIndex((stage) => stage.kind !== "open");
  const insertAt = input.kind === "open" && firstClosed >= 0 ? firstClosed : stages.length;
  const draft = [...stages.slice(0, insertAt), { id: "new", name, kind: input.kind, position: 0 }, ...stages.slice(insertAt)];
  const errors = validatePipeline(draft);
  if (errors.length) throw new CrmError("invalid", errors[0]);
  await sql.transaction([
    ...stages.map((stage) => ({
      text: `UPDATE crm_pipeline_stages SET position = $3 WHERE workspace_id = $1 AND id = $2`,
      params: [ctx.workspace.id, stage.id, draft.findIndex((item) => item.id === stage.id)]
    })),
    { text: `INSERT INTO crm_pipeline_stages (workspace_id, name, kind, position) VALUES ($1, $2, $3, $4)`, params: [ctx.workspace.id, name, input.kind, insertAt] }
  ]);
}

export async function reorderStage(ctx: CrmContext, stageId: string, direction: "up" | "down") {
  requirePipelineAdmin(ctx);
  const next = moveStage(await listStages(ctx), stageId, direction);
  await sql.transaction(next.map((stage) => ({ text: `UPDATE crm_pipeline_stages SET position = $3 WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, stage.id, stage.position] })));
}

export async function removeStage(ctx: CrmContext, stageId: string, moveDealsTo: string | null) {
  requirePipelineAdmin(ctx);
  const stages = await listStages(ctx);
  const [{ count }] = await q(`SELECT count(*)::int AS count FROM crm_deals WHERE workspace_id = $1 AND stage_id = $2`, [ctx.workspace.id, stageId]);
  const plan = planStageRemoval(stages, stageId, Number(count), moveDealsTo);
  if (!plan.ok) throw new CrmError("invalid", plan.error);
  const statements: Array<{ text: string; params: unknown[] }> = [];
  if (plan.moveDealsTo) {
    const from = stages.find((stage) => stage.id === stageId);
    const to = stages.find((stage) => stage.id === plan.moveDealsTo);
    statements.push({
      text: `INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, actor_profile_id, type, payload)
             SELECT $1, id, establishment_id, $3, 'stage.changed', $4::jsonb FROM crm_deals WHERE workspace_id = $1 AND stage_id = $2`,
      params: [ctx.workspace.id, stageId, ctx.profileId, JSON.stringify({ fromStageId: stageId, toStageId: plan.moveDealsTo, from: from?.name ?? null, to: to?.name ?? null, via: "stage_removed" })]
    });
    statements.push({ text: `UPDATE crm_deals SET stage_id = $3, updated_at = NOW() WHERE workspace_id = $1 AND stage_id = $2`, params: [ctx.workspace.id, stageId, plan.moveDealsTo] });
  }
  statements.push({ text: `DELETE FROM crm_pipeline_stages WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, stageId] });
  await sql.transaction(statements);
  // Renumera para manter posições densas.
  const remaining = sortStages(await listStages(ctx));
  await sql.transaction(remaining.map((stage, index) => ({ text: `UPDATE crm_pipeline_stages SET position = $3 WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, stage.id, index] })));
}

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

export async function createTeamWorkspace(profileId: string, name: string) {
  const rows = await q(
    `WITH ws AS (
       INSERT INTO crm_workspaces (name, owner_profile_id, is_personal) VALUES ($1, $2, FALSE) RETURNING id
     ), member AS (
       INSERT INTO crm_workspace_members (workspace_id, profile_id, role) SELECT id, $2, 'owner' FROM ws
     ), stages AS (${seedStagesSql("ws")})
     SELECT id FROM ws`,
    [name, profileId]
  );
  return str(rows[0]?.id);
}

export async function addMemberByEmail(ctx: CrmContext, email: string, role: CrmRole) {
  const actor = { profileId: ctx.profileId, role: ctx.role };
  if (!canManageMembers(actor) || role === "owner") throw new CrmError("forbidden", "Sem permissão para adicionar membros com esse papel.");
  if (ctx.workspace.isPersonal) throw new CrmError("invalid", "O CRM pessoal não tem equipe. Crie uma equipe para convidar pessoas.");
  if (ctx.role === "admin" && role === "admin") throw new CrmError("forbidden", "Somente o proprietário adiciona administradores.");
  const rows = await q(
    `SELECT p.id FROM profiles p LEFT JOIN users u ON u.id = p.user_id
      WHERE lower(p.email) = $1 OR lower(u.email) = $1 LIMIT 1`,
    [email.toLowerCase()]
  );
  const profileId = strOrNull(rows[0]?.id);
  if (!profileId) return { added: false };
  await q(`INSERT INTO crm_workspace_members (workspace_id, profile_id, role) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, profile_id) DO NOTHING`, [ctx.workspace.id, profileId, role]);
  return { added: true };
}

export async function changeMember(ctx: CrmContext, targetProfileId: string, next: CrmRole | "remove") {
  const members = await listMembers(ctx);
  const target = members.find((member) => member.profileId === targetProfileId);
  if (!target) throw new CrmError("not_found", "Membro não encontrado.");
  const actor = { profileId: ctx.profileId, role: ctx.role };
  if (!canChangeMember(actor, target, next)) throw new CrmError("forbidden", "Sem permissão para alterar este membro.");
  if (ctx.role === "admin" && next === "admin" && target.profileId !== ctx.profileId) throw new CrmError("forbidden", "Somente o proprietário promove administradores.");
  if (next === "remove") {
    // Negócios e tarefas do membro removido ficam sem responsável (não somem, não vazam).
    await sql.transaction([
      { text: `UPDATE crm_deals SET owner_profile_id = NULL, updated_at = NOW() WHERE workspace_id = $1 AND owner_profile_id = $2`, params: [ctx.workspace.id, targetProfileId] },
      { text: `UPDATE crm_tasks SET assignee_profile_id = NULL, updated_at = NOW() WHERE workspace_id = $1 AND assignee_profile_id = $2`, params: [ctx.workspace.id, targetProfileId] },
      { text: `DELETE FROM crm_workspace_members WHERE workspace_id = $1 AND profile_id = $2`, params: [ctx.workspace.id, targetProfileId] }
    ]);
    return;
  }
  await q(`UPDATE crm_workspace_members SET role = $3 WHERE workspace_id = $1 AND profile_id = $2`, [ctx.workspace.id, targetProfileId, next]);
}

