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
import { randomUUID } from "node:crypto";
import { firstWhatsappNumber } from "@/lib/whatsapp";
import { dealChangeActivities, dealCreatedActivity, type DealPatch, type InteractionOutcome } from "./timeline";
import { isUuid, planImport } from "./input";
import { PROSPECT_ORIGIN_LABEL, duplicateKeys, isPriority, isProspectOrigin, type DealFields, type ProspectFields, type ProspectOrigin } from "./prospects";
import { DEFAULT_TEMPLATES, type MessageTemplate } from "./templates";
import type {
  ActivityDraft,
  CrmActivity,
  CrmCompanyRef,
  CrmContact,
  CrmContext,
  InteractionChannel,
  ProspectRecord,
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

// Alvo do negócio: empresa da base (e.*) OU prospect manual (pr.*), nunca os dois
// (CHECK crm_deals_one_target). O prospect é lido com o mesmo workspace_id do negócio.
const DEAL_SELECT = `
  SELECT d.*, e.cnpj, e.company_name, e.trade_name, e.city_name, e.state_code, e.phone AS e_phone,
         pr.kind AS pr_kind, pr.name AS pr_name, pr.trade_name AS pr_trade_name, pr.city_name AS pr_city_name,
         pr.state_code AS pr_state_code, pr.whatsapp AS pr_whatsapp, pr.phone AS pr_phone, pr.phone_secondary AS pr_phone_secondary,
         ${DISPLAY_NAME} AS owner_name, t.open_tasks, t.next_due
    FROM crm_deals d
    LEFT JOIN establishments e ON e.id = d.establishment_id
    LEFT JOIN crm_prospects pr ON pr.workspace_id = d.workspace_id AND pr.id = d.prospect_id
    LEFT JOIN profiles p ON p.id = d.owner_profile_id
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS open_tasks, min(due_at) AS next_due
        FROM crm_tasks ct
       WHERE ct.workspace_id = d.workspace_id AND ct.deal_id = d.id AND ct.status = 'todo'
    ) t ON TRUE`;

function mapCompanyRef(row: Row): CrmCompanyRef {
  if (row.prospect_id) {
    const whatsapp = firstWhatsappNumber(row.pr_whatsapp, row.pr_phone, row.pr_phone_secondary);
    return {
      kind: "prospect",
      establishmentId: null,
      prospectId: str(row.prospect_id),
      cnpj: "",
      companyName: str(row.pr_name) || "Prospect sem nome",
      tradeName: str(row.pr_trade_name),
      cityName: str(row.pr_city_name),
      stateCode: str(row.pr_state_code),
      whatsappPhone: whatsapp?.raw ?? null,
      personKind: row.pr_kind === "person" ? "person" : "company"
    };
  }
  return {
    kind: "establishment",
    establishmentId: str(row.establishment_id),
    prospectId: null,
    cnpj: str(row.cnpj),
    companyName: str(row.company_name) || "Empresa sem razão social",
    tradeName: str(row.trade_name),
    cityName: str(row.city_name),
    stateCode: str(row.state_code),
    whatsappPhone: firstWhatsappNumber(row.e_phone)?.raw ?? null,
    personKind: "company"
  };
}

function mapDeal(row: Row): DealView {
  return {
    id: str(row.id),
    establishmentId: strOrNull(row.establishment_id),
    prospectId: strOrNull(row.prospect_id),
    priority: isPriority(row.priority) ? row.priority : "normal",
    nextContactAt: iso(row.next_contact_at),
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
    company: mapCompanyRef(row)
  };
}

export type DealFilters = {
  owner?: "me" | "none" | string;
  q?: string;
  source?: DealSource | "";
  /** Origem comercial do prospect manual (crm_prospects.origin). */
  origin?: ProspectOrigin | "";
  /** "establishment" = empresas da base; "prospect" = cadastros manuais. */
  target?: "establishment" | "prospect" | "";
  stageId?: string;
};

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
  if (filters.origin) {
    params.push(filters.origin);
    where.push(`pr.origin = $${params.length}`);
  }
  if (filters.target === "prospect") where.push("d.prospect_id IS NOT NULL");
  else if (filters.target === "establishment") where.push("d.establishment_id IS NOT NULL");
  const term = (filters.q ?? "").trim().slice(0, 80);
  if (term) {
    params.push(`%${term.replace(/[%_\\]/g, (match) => `\\${match}`)}%`);
    const like = `$${params.length}`;
    // Nome, cidade, título, e-mail (prospect e contatos do workspace).
    const clauses = [
      `e.company_name ILIKE ${like}`, `e.trade_name ILIKE ${like}`, `e.city_name ILIKE ${like}`, `d.title ILIKE ${like}`,
      `pr.name ILIKE ${like}`, `pr.trade_name ILIKE ${like}`, `pr.city_name ILIKE ${like}`, `pr.email ILIKE ${like}`, `pr.contact_name ILIKE ${like}`,
      `EXISTS (SELECT 1 FROM crm_contacts c WHERE c.workspace_id = d.workspace_id
                  AND ((d.prospect_id IS NOT NULL AND c.prospect_id = d.prospect_id) OR (d.establishment_id IS NOT NULL AND c.establishment_id = d.establishment_id))
                  AND (c.name ILIKE ${like} OR c.email ILIKE ${like}))`
    ];
    const digits = term.replace(/\D/g, "");
    if (digits.length >= 4) {
      // Documento (CNPJ oficial ou CPF/CNPJ do prospect) e telefones, comparando só dígitos.
      params.push(`%${digits}%`);
      const digitsLike = `$${params.length}`;
      clauses.push(
        `e.cnpj LIKE ${digitsLike}`,
        `pr.document LIKE ${digitsLike}`,
        `regexp_replace(COALESCE(pr.phone, '') || ' ' || COALESCE(pr.whatsapp, '') || ' ' || COALESCE(pr.phone_secondary, ''), '\\D', '', 'g') LIKE ${digitsLike}`,
        `EXISTS (SELECT 1 FROM crm_contacts c WHERE c.workspace_id = d.workspace_id
                    AND ((d.prospect_id IS NOT NULL AND c.prospect_id = d.prospect_id) OR (d.establishment_id IS NOT NULL AND c.establishment_id = d.establishment_id))
                    AND regexp_replace(COALESCE(c.phone, '') || ' ' || COALESCE(c.whatsapp, ''), '\\D', '', 'g') LIKE ${digitsLike})`
      );
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
    text: `INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, prospect_id, actor_profile_id, type, payload) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    params: [ctx.workspace.id, draft.dealId, draft.establishmentId, draft.prospectId ?? null, draft.actorProfileId, draft.type, JSON.stringify(draft.payload)]
  };
}

/** Alvo do negócio para histórico e contatos. */
function targetOf(deal: Pick<DealView, "establishmentId" | "prospectId">) {
  return { establishmentId: deal.establishmentId, prospectId: deal.prospectId };
}

/** Filtro SQL de contatos do alvo do negócio (empresa da base ou prospect). */
function contactTargetClause(deal: Pick<DealView, "establishmentId" | "prospectId">, firstParam: number) {
  return deal.prospectId
    ? { sql: `prospect_id = $${firstParam}`, value: deal.prospectId }
    : { sql: `establishment_id = $${firstParam}`, value: deal.establishmentId };
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
  if (patch.priority !== undefined) set("priority", patch.priority);
  if (patch.primaryContactId !== undefined) {
    if (patch.primaryContactId) {
      const target = contactTargetClause(deal, 3);
      const contact = await q(`SELECT id FROM crm_contacts WHERE workspace_id = $1 AND id = $2 AND ${target.sql}`, [ctx.workspace.id, patch.primaryContactId, target.value]);
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
    { dealId, ...targetOf(deal), actorProfileId: ctx.profileId },
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
      ...targetOf(deal),
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
  if (deal.prospectId) {
    // Prospect manual existe só por causa do negócio: sai junto (LGPD — não deixa dado
    // pessoal órfão e inacessível). Contatos do prospect caem em cascata; o histórico do
    // negócio (que pode citar nomes e resumos de conversas) é apagado, e fica só um
    // evento de auditoria sem dado pessoal.
    await sql.transaction([
      { text: `DELETE FROM crm_activities WHERE workspace_id = $1 AND (deal_id = $2 OR prospect_id = $3)`, params: [ctx.workspace.id, dealId, deal.prospectId] },
      activityInsert(ctx, { type: "deal.deleted", dealId: null, establishmentId: null, prospectId: null, actorProfileId: ctx.profileId, payload: { kind: "prospect" } }),
      { text: `DELETE FROM crm_deals WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, dealId] },
      { text: `DELETE FROM crm_prospects WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, deal.prospectId] }
    ]);
    return { kind: "prospect" as const };
  }
  await sql.transaction([
    activityInsert(ctx, { type: "deal.deleted", dealId, establishmentId: deal.establishmentId, actorProfileId: ctx.profileId, payload: {} }),
    { text: `DELETE FROM crm_deals WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, dealId] }
  ]);
  return { kind: "establishment" as const };
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
     INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, prospect_id, actor_profile_id, type, payload)
     SELECT $1, $2, $5, $6, $4, 'note.created', jsonb_build_object('noteId', n.id) FROM n`,
    [ctx.workspace.id, dealId, body, ctx.profileId, deal.establishmentId, deal.prospectId]
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
     INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, prospect_id, actor_profile_id, type, payload)
     SELECT $1, $2, $7, $9, $6, 'task.created', $8::jsonb || jsonb_build_object('taskId', t.id) FROM t`,
    [ctx.workspace.id, dealId, input.title, input.dueAt, assignee, ctx.profileId, deal.establishmentId, JSON.stringify({ title: input.title, dueAt: input.dueAt, assigneeId: assignee }), deal.prospectId]
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
    activityInsert(ctx, { type: done ? "task.completed" : "task.reopened", dealId: task.dealId, ...targetOf(deal), actorProfileId: ctx.profileId, payload: { taskId, title: task.title } })
  ]);
}

function mapContact(row: Row): CrmContact {
  return {
    id: str(row.id),
    establishmentId: strOrNull(row.establishment_id),
    prospectId: strOrNull(row.prospect_id),
    name: str(row.name),
    jobTitle: strOrNull(row.job_title),
    email: strOrNull(row.email),
    phone: strOrNull(row.phone),
    whatsapp: strOrNull(row.whatsapp),
    createdAt: iso(row.created_at) ?? ""
  };
}

/** Contatos de uma empresa da base (string) ou do alvo de um negócio (empresa ou prospect). */
export async function listContacts(ctx: CrmContext, target: string | Pick<DealView, "establishmentId" | "prospectId">): Promise<CrmContact[]> {
  const ref = typeof target === "string" ? { establishmentId: target, prospectId: null } : target;
  if (!ref.establishmentId && !ref.prospectId) return [];
  const clause = contactTargetClause(ref, 2);
  const rows = await q(`SELECT * FROM crm_contacts WHERE workspace_id = $1 AND ${clause.sql} ORDER BY name`, [ctx.workspace.id, clause.value]);
  return rows.map(mapContact);
}

export async function addContact(ctx: CrmContext, dealId: string, input: { name: string; jobTitle: string | null; email: string | null; phone: string | null; whatsapp?: string | null; makePrimary: boolean }) {
  const deal = await requireDeal(ctx, dealId);
  if (!canManageContacts({ profileId: ctx.profileId, role: ctx.role })) throw new CrmError("forbidden", "Sem permissão.");
  const setPrimary = input.makePrimary && canEditDeal({ profileId: ctx.profileId, role: ctx.role }, deal);
  // Nome do contato no histórico: é dado inserido pelo próprio usuário, necessário para a trilha.
  await q(
    `WITH c AS (
       INSERT INTO crm_contacts (workspace_id, establishment_id, prospect_id, name, job_title, email, phone, whatsapp, created_by)
       VALUES ($1, $2, $10, $3, $4, $5, $6, $11, $7) RETURNING id
     ), primary_link AS (
       UPDATE crm_deals SET primary_contact_id = c.id, updated_at = NOW() FROM c
        WHERE $9::boolean AND crm_deals.workspace_id = $1 AND crm_deals.id = $8
     )
     INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, prospect_id, actor_profile_id, type, payload)
     SELECT $1, $8, $2, $10, $7, 'contact.created', jsonb_build_object('contactId', c.id, 'name', $3::text, 'primary', $9::boolean) FROM c`,
    [ctx.workspace.id, deal.establishmentId, input.name, input.jobTitle, input.email, input.phone, ctx.profileId, dealId, setPrimary, deal.prospectId, input.whatsapp ?? null]
  );
}

export async function deleteContact(ctx: CrmContext, dealId: string, contactId: string) {
  const deal = await requireDeal(ctx, dealId);
  if (!canEditDeal({ profileId: ctx.profileId, role: ctx.role }, deal)) throw new CrmError("forbidden", "Somente o responsável ou um administrador pode excluir contatos.");
  if (!isUuid(contactId)) throw new CrmError("not_found", "Contato não encontrado.");
  const clause = contactTargetClause(deal, 3);
  const rows = await q(`SELECT name FROM crm_contacts WHERE workspace_id = $1 AND id = $2 AND ${clause.sql}`, [ctx.workspace.id, contactId, clause.value]);
  if (!rows.length) throw new CrmError("not_found", "Contato não encontrado.");
  await sql.transaction([
    activityInsert(ctx, { type: "contact.deleted", dealId, ...targetOf(deal), actorProfileId: ctx.profileId, payload: { contactId, name: str(rows[0].name) } }),
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
    prospectId: strOrNull(row.prospect_id),
    actorProfileId: strOrNull(row.actor_profile_id),
    actorName: row.actor_profile_id ? str(row.actor_name) : null,
    type: str(row.type) as CrmActivity["type"],
    payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
    happenedAt: iso(row.happened_at) ?? ""
  }));
}

// ---------------------------------------------------------------------------
// Prospects manuais (Fase 8)
// ---------------------------------------------------------------------------

function mapProspect(row: Row): ProspectRecord {
  return {
    id: str(row.id),
    kind: row.kind === "person" ? "person" : "company",
    name: str(row.name),
    tradeName: strOrNull(row.trade_name),
    documentType: row.document_type === "cpf" || row.document_type === "cnpj" ? row.document_type : null,
    document: strOrNull(row.document),
    origin: isProspectOrigin(row.origin) ? row.origin : "manual",
    originDetail: strOrNull(row.origin_detail),
    segment: strOrNull(row.segment),
    cityName: strOrNull(row.city_name),
    stateCode: strOrNull(row.state_code),
    address: strOrNull(row.address),
    contactName: strOrNull(row.contact_name),
    contactRole: strOrNull(row.contact_role),
    phone: strOrNull(row.phone),
    whatsapp: strOrNull(row.whatsapp),
    phoneSecondary: strOrNull(row.phone_secondary),
    email: strOrNull(row.email),
    website: strOrNull(row.website),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    createdBy: strOrNull(row.created_by),
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? ""
  };
}

export async function getProspect(ctx: CrmContext, prospectId: string | null) {
  if (!isUuid(prospectId)) return null;
  const rows = await q(`SELECT * FROM crm_prospects WHERE workspace_id = $1 AND id = $2`, [ctx.workspace.id, prospectId]);
  return rows[0] ? mapProspect(rows[0]) : null;
}

/**
 * A empresa da base já é acessível a este usuário? Mesmas regras de lib/search/visibility.ts:
 * resultado de busca liberada (paid/free), empresa salva por ele ou negócio em um workspace
 * do qual participa. Sem isso, o cadastro manual não revela nem vincula a empresa (a
 * verificação de CNPJ não pode virar um atalho para dados ainda não liberados).
 */
async function isEstablishmentVisible(ctx: CrmContext, establishmentId: string) {
  const [flags] = await q(
    `SELECT EXISTS (
              SELECT 1 FROM crm_deals d
                JOIN crm_workspace_members m ON m.workspace_id = d.workspace_id AND m.profile_id = $2
               WHERE d.establishment_id = $1
            ) AS in_crm,
            to_regclass('public.saved_establishments') IS NOT NULL AS has_saved,
            (to_regclass('public.search_results') IS NOT NULL AND to_regclass('public.search_access_orders') IS NOT NULL) AS has_orders`,
    [establishmentId, ctx.profileId]
  );
  if (flags?.in_crm === true) return true;
  if (flags?.has_saved === true) {
    const saved = await q(`SELECT 1 FROM saved_establishments WHERE establishment_id = $1 AND profile_id = $2 LIMIT 1`, [establishmentId, ctx.profileId]);
    if (saved.length) return true;
  }
  if (flags?.has_orders === true) {
    const paid = await q(
      `SELECT 1 FROM search_results sr
         JOIN search_access_orders o ON o.search_query_id = sr.search_query_id AND o.status IN ('paid', 'free')
        WHERE sr.establishment_id = $1 AND COALESCE(o.profile_id, sr.profile_id) = $2 LIMIT 1`,
      [establishmentId, ctx.profileId]
    );
    if (paid.length) return true;
  }
  return false;
}

export type DuplicateReport = {
  /** Empresa com o mesmo CNPJ na base BuscaCNAE (dado oficial). */
  establishment: { id: string; cnpj: string; companyName: string; cityName: string; stateCode: string; dealId: string | null } | null;
  /** Negócios do workspace que parecem ser a mesma pessoa/empresa. Nunca mesclados automaticamente. */
  matches: Array<{ dealId: string; name: string; reasons: Array<"document" | "phone" | "email">; via: "prospect" | "contact" }>;
};

/**
 * Possíveis duplicidades por documento, telefone e e-mail, SOMENTE no workspace ativo
 * (mais a base oficial de CNPJ). Telefones: pré-filtro pelos 8 últimos dígitos no
 * banco e confirmação pelo número normalizado (lib/whatsapp) em memória.
 */
export async function findDuplicates(
  ctx: CrmContext,
  input: { documentType: "cnpj" | "cpf" | null; document: string | null; phones: Array<string | null | undefined>; email: string | null; ignoreProspectId?: string | null }
): Promise<DuplicateReport> {
  const keys = duplicateKeys({ document: input.document, phones: input.phones, email: input.email });
  const tails = keys.phones.map((digits) => digits.slice(-8));
  const ignore = isUuid(input.ignoreProspectId) ? input.ignoreProspectId : null;

  let establishment: DuplicateReport["establishment"] = null;
  if (input.documentType === "cnpj" && keys.document) {
    const rows = await q(
      `SELECT e.id, e.cnpj, e.company_name, e.city_name, e.state_code, d.id AS deal_id
         FROM establishments e
         LEFT JOIN crm_deals d ON d.workspace_id = $2 AND d.establishment_id = e.id
        WHERE e.cnpj = $1 LIMIT 1`,
      [keys.document, ctx.workspace.id]
    );
    if (rows[0] && (await isEstablishmentVisible(ctx, str(rows[0].id)))) {
      establishment = {
        id: str(rows[0].id),
        cnpj: str(rows[0].cnpj),
        companyName: str(rows[0].company_name) || "Empresa sem razão social",
        cityName: str(rows[0].city_name),
        stateCode: str(rows[0].state_code),
        dealId: strOrNull(rows[0].deal_id)
      };
    }
  }

  if (!keys.document && !keys.email && !tails.length) return { establishment, matches: [] };

  const phoneExpr = (columns: string[], param: string) => columns.map((column) => `right(regexp_replace(COALESCE(${column}, ''), '\\D', '', 'g'), 8) = ANY(${param}::text[])`).join(" OR ");
  const [prospectRows, contactRows] = await Promise.all([
    q(
      `SELECT pr.*, d.id AS deal_id FROM crm_prospects pr
         JOIN crm_deals d ON d.workspace_id = pr.workspace_id AND d.prospect_id = pr.id
        WHERE pr.workspace_id = $1 AND ($5::uuid IS NULL OR pr.id <> $5::uuid)
          AND ((pr.document IS NOT NULL AND pr.document = $2) OR (pr.email IS NOT NULL AND lower(pr.email) = $3)
               OR (cardinality($4::text[]) > 0 AND (${phoneExpr(["pr.phone", "pr.whatsapp", "pr.phone_secondary"], "$4")})))
        LIMIT 20`,
      [ctx.workspace.id, keys.document, keys.email, tails, ignore]
    ),
    q(
      `SELECT c.*, d.id AS deal_id, COALESCE(pr.name, e.company_name) AS target_name FROM crm_contacts c
         JOIN crm_deals d ON d.workspace_id = c.workspace_id
              AND ((c.prospect_id IS NOT NULL AND d.prospect_id = c.prospect_id) OR (c.establishment_id IS NOT NULL AND d.establishment_id = c.establishment_id))
         LEFT JOIN crm_prospects pr ON pr.workspace_id = c.workspace_id AND pr.id = c.prospect_id
         LEFT JOIN establishments e ON e.id = c.establishment_id
        WHERE c.workspace_id = $1 AND ($4::uuid IS NULL OR c.prospect_id IS DISTINCT FROM $4::uuid)
          AND ((c.email IS NOT NULL AND lower(c.email) = $2) OR (cardinality($3::text[]) > 0 AND (${phoneExpr(["c.phone", "c.whatsapp"], "$3")})))
        LIMIT 20`,
      [ctx.workspace.id, keys.email, tails, ignore]
    )
  ]);

  const phoneSet = new Set(keys.phones);
  const samePhone = (...values: unknown[]) => duplicateKeys({ phones: values.map((value) => strOrNull(value)) }).phones.some((digits) => phoneSet.has(digits));
  const matches = new Map<string, DuplicateReport["matches"][number]>();
  const add = (dealId: string, name: string, reason: "document" | "phone" | "email", via: "prospect" | "contact") => {
    const current = matches.get(dealId) ?? { dealId, name, reasons: [], via };
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    matches.set(dealId, current);
  };
  for (const row of prospectRows) {
    const dealId = str(row.deal_id);
    const name = str(row.trade_name) || str(row.name);
    if (keys.document && str(row.document) === keys.document) add(dealId, name, "document", "prospect");
    if (keys.email && str(row.email).toLowerCase() === keys.email) add(dealId, name, "email", "prospect");
    if (samePhone(row.phone, row.whatsapp, row.phone_secondary)) add(dealId, name, "phone", "prospect");
  }
  for (const row of contactRows) {
    const dealId = str(row.deal_id);
    const name = `${str(row.name)} (${str(row.target_name) || "negócio"})`;
    if (keys.email && str(row.email).toLowerCase() === keys.email) add(dealId, name, "email", "contact");
    if (samePhone(row.phone, row.whatsapp)) add(dealId, name, "phone", "contact");
  }
  if (establishment?.dealId) matches.delete(establishment.dealId);
  return { establishment, matches: [...matches.values()] };
}

function prospectParams(prospect: ProspectFields) {
  return [
    prospect.kind, prospect.name, prospect.tradeName, prospect.documentType, prospect.document, prospect.origin, prospect.originDetail,
    prospect.segment, prospect.cityName, prospect.stateCode, prospect.address, prospect.contactName, prospect.contactRole,
    prospect.phone, prospect.whatsapp, prospect.phoneSecondary, prospect.email, prospect.website, prospect.tags
  ];
}

const PROSPECT_COLUMNS = [
  "kind", "name", "trade_name", "document_type", "document", "origin", "origin_detail", "segment", "city_name", "state_code", "address",
  "contact_name", "contact_role", "phone", "whatsapp", "phone_secondary", "email", "website", "tags"
] as const;

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505");
}

async function resolveNewDealOwner(ctx: CrmContext, requested: string | null) {
  const members = await listMembers(ctx);
  const memberIds = new Set(members.map((member) => member.profileId));
  const ownerId = requested && isUuid(requested) ? requested : ctx.profileId;
  if (!canAssignDeal({ profileId: ctx.profileId, role: ctx.role }, { ownerProfileId: null }, ownerId, memberIds)) {
    throw new CrmError("forbidden", "Você não pode atribuir o negócio a outro membro.");
  }
  return { ownerId, members };
}

/**
 * Cadastro manual → CRM, em uma transação: prospect + negócio + histórico (+ nota e
 * próximo contato). Com `linkEstablishmentId`, o negócio referencia a empresa da base
 * (dado oficial, sem cópia) e o responsável informado vira um contato do workspace.
 */
export async function createManualDeal(
  ctx: CrmContext,
  prospect: ProspectFields,
  deal: DealFields,
  options: { linkEstablishmentId?: string | null } = {}
): Promise<{ dealId: string; linked: boolean }> {
  const stages = await listStages(ctx);
  const stage = (deal.stageId && stages.find((item) => item.id === deal.stageId)) || entryStage(stages);
  if (!stage) throw new CrmError("invalid", "Configure ao menos uma etapa no pipeline.");
  const { ownerId } = await resolveNewDealOwner(ctx, deal.ownerProfileId);
  const [top] = await q(`SELECT MIN(position) AS top FROM crm_deals WHERE workspace_id = $1 AND stage_id = $2`, [ctx.workspace.id, stage.id]);
  const position = (top?.top === null || top?.top === undefined ? POSITION_STEP : Number(top.top)) - POSITION_STEP;
  const closedAt = isClosedStage(stage) ? new Date().toISOString() : null;
  const dealId = randomUUID();
  const statements: Array<{ text: string; params: unknown[] }> = [];

  let establishmentId: string | null = null;
  let prospectId: string | null = null;
  if (options.linkEstablishmentId) {
    if (!isUuid(options.linkEstablishmentId)) throw new CrmError("invalid", "Nenhuma empresa válida selecionada.");
    const rows = await q(`SELECT id, cnpj FROM establishments WHERE id = $1`, [options.linkEstablishmentId]);
    // Vínculo só com empresa que o usuário já pode ver E cujo CNPJ é o informado no formulário
    // (um id forjado ou desatualizado no campo oculto não passa).
    if (!rows.length || !(await isEstablishmentVisible(ctx, options.linkEstablishmentId))) throw new CrmError("not_found", "Nenhuma empresa válida selecionada.");
    if (prospect.documentType !== "cnpj" || str(rows[0].cnpj) !== prospect.document) {
      throw new CrmError("invalid", "Nenhuma empresa válida selecionada: o CNPJ informado não corresponde à empresa vinculada.");
    }
    const existing = await dealIdsByEstablishment(ctx, [options.linkEstablishmentId]);
    if (existing.size) throw new CrmError("conflict", "Já existe um negócio para esta empresa neste workspace.");
    establishmentId = options.linkEstablishmentId;
  } else {
    prospectId = randomUUID();
    statements.push({
      text: `INSERT INTO crm_prospects (id, workspace_id, created_by, ${PROSPECT_COLUMNS.join(", ")})
             VALUES ($1, $2, $3, ${PROSPECT_COLUMNS.map((_, index) => `$${index + 4}`).join(", ")})`,
      params: [prospectId, ctx.workspace.id, ctx.profileId, ...prospectParams(prospect)]
    });
  }

  statements.push({
    text: `INSERT INTO crm_deals (id, workspace_id, establishment_id, prospect_id, stage_id, position, owner_profile_id, amount_cents,
                                  expected_close_date, priority, next_contact_at, source, closed_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', $12, $13)`,
    params: [dealId, ctx.workspace.id, establishmentId, prospectId, stage.id, position, ownerId, deal.amountCents, deal.expectedCloseDate, deal.priority, deal.nextContactAt, closedAt, ctx.profileId]
  });

  const base = { dealId, establishmentId, prospectId, actorProfileId: ctx.profileId };
  statements.push(activityInsert(ctx, dealCreatedActivity(base, { stageName: stage.name, source: "manual", sourceLabel: PROSPECT_ORIGIN_LABEL[prospect.origin] })));
  // "prospect.created" só para cadastro manual; no vínculo com a ficha oficial, a origem
  // comercial fica no deal.created (sourceLabel) e não há prospect.
  if (prospectId) {
    statements.push(activityInsert(ctx, { ...base, type: "prospect.created", payload: { origin: prospect.origin, originDetail: prospect.originDetail } }));
  }

  if (establishmentId && (prospect.contactName || prospect.phone || prospect.whatsapp || prospect.email)) {
    // Dados de contato informados pelo usuário viram contato do workspace (não tocam a ficha oficial).
    const contactId = randomUUID();
    const contactName = prospect.contactName ?? "Contato principal";
    statements.push({
      text: `INSERT INTO crm_contacts (id, workspace_id, establishment_id, name, job_title, email, phone, whatsapp, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      params: [contactId, ctx.workspace.id, establishmentId, contactName, prospect.contactRole, prospect.email, prospect.phone ?? prospect.phoneSecondary, prospect.whatsapp, ctx.profileId]
    });
    statements.push({ text: `UPDATE crm_deals SET primary_contact_id = $3 WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, dealId, contactId] });
    statements.push(activityInsert(ctx, { ...base, type: "contact.created", payload: { contactId, name: contactName, primary: true } }));
  }
  if (deal.nextContactAt) statements.push(activityInsert(ctx, { ...base, type: "next_contact.scheduled", payload: { at: deal.nextContactAt } }));
  if (deal.notes) {
    const noteId = randomUUID();
    statements.push({ text: `INSERT INTO crm_notes (id, workspace_id, deal_id, body, author_profile_id) VALUES ($1, $2, $3, $4, $5)`, params: [noteId, ctx.workspace.id, dealId, deal.notes, ctx.profileId] });
    statements.push(activityInsert(ctx, { ...base, type: "note.created", payload: { noteId } }));
  }

  try {
    await sql.transaction(statements);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CrmError("conflict", establishmentId ? "Já existe um negócio para esta empresa neste workspace." : "Já existe um prospect com este documento neste workspace.");
    }
    throw error;
  }
  return { dealId, linked: Boolean(establishmentId) };
}

/** Edição do cadastro manual. Registra QUAIS campos mudaram (sem os valores pessoais). */
export async function updateProspect(ctx: CrmContext, dealId: string, next: ProspectFields) {
  const deal = await requireDeal(ctx, dealId);
  if (!deal.prospectId) throw new CrmError("invalid", "Prospect não encontrado. Empresas da base são editadas pela ficha oficial.");
  if (!canEditDeal({ profileId: ctx.profileId, role: ctx.role }, deal)) throw new CrmError("forbidden", "Somente o responsável ou um administrador pode editar este negócio.");
  const current = await getProspect(ctx, deal.prospectId);
  if (!current) throw new CrmError("not_found", "Prospect não encontrado.");

  const keys = Object.keys(next) as Array<keyof ProspectFields>;
  const changed = keys.filter((key) => JSON.stringify(current[key as keyof ProspectRecord] ?? null) !== JSON.stringify(next[key] ?? null));
  const fields = Array.from(new Set(changed.map((key) => (key === "documentType" ? "document" : key))));
  if (!fields.length) return;

  try {
    await sql.transaction([
      {
        text: `UPDATE crm_prospects SET ${PROSPECT_COLUMNS.map((column, index) => `${column} = $${index + 3}`).join(", ")}, updated_at = NOW()
                WHERE workspace_id = $1 AND id = $2`,
        params: [ctx.workspace.id, deal.prospectId, ...prospectParams(next)]
      },
      { text: `UPDATE crm_deals SET updated_at = NOW() WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, dealId] },
      activityInsert(ctx, { type: "prospect.updated", dealId, ...targetOf(deal), actorProfileId: ctx.profileId, payload: { fields } })
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new CrmError("conflict", "Já existe um prospect com este documento neste workspace.");
    throw error;
  }
}

/**
 * Interação registrada EXPLICITAMENTE pelo usuário (ligação, WhatsApp, reunião…).
 * Abrir o WhatsApp não chama esta função: o sistema não sabe se houve envio/resposta.
 */
export async function logInteraction(
  ctx: CrmContext,
  dealId: string,
  input: { channel: InteractionChannel; outcome: InteractionOutcome | null; occurredAt: string | null; summary: string | null; completeNextContact: boolean; nextContactAt?: string | null }
) {
  const deal = await requireDeal(ctx, dealId);
  if (!canAddActivity({ profileId: ctx.profileId, role: ctx.role })) throw new CrmError("forbidden", "Sem permissão.");
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const statements = [
    activityInsert(ctx, {
      type: "interaction.logged",
      dealId,
      ...targetOf(deal),
      actorProfileId: ctx.profileId,
      payload: { channel: input.channel, outcome: input.outcome, occurredAt, summary: input.summary }
    })
  ];
  const editable = canEditDeal({ profileId: ctx.profileId, role: ctx.role }, deal);
  const wantsSchedule = input.nextContactAt !== undefined && input.nextContactAt !== null;
  if ((input.completeNextContact || wantsSchedule) && editable) {
    const nextAt = wantsSchedule ? input.nextContactAt ?? null : null;
    if (nextAt !== deal.nextContactAt) {
      statements.push({ text: `UPDATE crm_deals SET next_contact_at = $3, updated_at = NOW() WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, dealId, nextAt] });
      statements.push(activityInsert(ctx, { type: "next_contact.scheduled", dealId, ...targetOf(deal), actorProfileId: ctx.profileId, payload: { at: nextAt } }));
    }
  } else {
    statements.push({ text: `UPDATE crm_deals SET updated_at = NOW() WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, dealId] });
  }
  await sql.transaction(statements);
}

export async function scheduleNextContact(ctx: CrmContext, dealId: string, at: string | null) {
  const deal = await requireDeal(ctx, dealId);
  if (!canEditDeal({ profileId: ctx.profileId, role: ctx.role }, deal)) throw new CrmError("forbidden", "Somente o responsável ou um administrador pode editar este negócio.");
  if (at === deal.nextContactAt) return;
  await sql.transaction([
    { text: `UPDATE crm_deals SET next_contact_at = $3, updated_at = NOW() WHERE workspace_id = $1 AND id = $2`, params: [ctx.workspace.id, dealId, at] },
    activityInsert(ctx, { type: "next_contact.scheduled", dealId, ...targetOf(deal), actorProfileId: ctx.profileId, payload: { at } })
  ]);
}

// ---------------------------------------------------------------------------
// Modelos de mensagem
// ---------------------------------------------------------------------------

export async function listTemplates(ctx: CrmContext): Promise<MessageTemplate[]> {
  const rows = await q(`SELECT id, name, body, created_by FROM crm_message_templates WHERE workspace_id = $1 ORDER BY name LIMIT 100`, [ctx.workspace.id]);
  return [...DEFAULT_TEMPLATES, ...rows.map((row) => ({ id: str(row.id), name: str(row.name), body: str(row.body), isDefault: false, createdBy: strOrNull(row.created_by) }))];
}

export function canManageTemplate(ctx: CrmContext, template: Pick<MessageTemplate, "isDefault" | "createdBy">) {
  if (template.isDefault) return false;
  return ctx.role !== "member" || template.createdBy === ctx.profileId;
}

export async function saveTemplate(ctx: CrmContext, templateId: string | null, input: { name: string; body: string }) {
  if (!templateId) {
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM crm_message_templates WHERE workspace_id = $1`, [ctx.workspace.id]);
    if (Number(count) >= 100) throw new CrmError("invalid", "Use no máximo 100 modelos por workspace.");
    await q(`INSERT INTO crm_message_templates (workspace_id, name, body, created_by) VALUES ($1, $2, $3, $4)`, [ctx.workspace.id, input.name, input.body, ctx.profileId]);
    return;
  }
  const template = await requireTemplate(ctx, templateId);
  if (!canManageTemplate(ctx, template)) throw new CrmError("forbidden", "Somente quem criou o modelo ou um administrador pode alterá-lo.");
  await q(`UPDATE crm_message_templates SET name = $3, body = $4, updated_at = NOW() WHERE workspace_id = $1 AND id = $2`, [ctx.workspace.id, templateId, input.name, input.body]);
}

async function requireTemplate(ctx: CrmContext, templateId: string) {
  if (!isUuid(templateId)) throw new CrmError("not_found", "Modelo não encontrado.");
  const rows = await q(`SELECT id, name, body, created_by FROM crm_message_templates WHERE workspace_id = $1 AND id = $2`, [ctx.workspace.id, templateId]);
  if (!rows[0]) throw new CrmError("not_found", "Modelo não encontrado.");
  return { id: str(rows[0].id), name: str(rows[0].name), body: str(rows[0].body), isDefault: false, createdBy: strOrNull(rows[0].created_by) };
}

export async function deleteTemplate(ctx: CrmContext, templateId: string) {
  const template = await requireTemplate(ctx, templateId);
  if (!canManageTemplate(ctx, template)) throw new CrmError("forbidden", "Somente quem criou o modelo ou um administrador pode alterá-lo.");
  await q(`DELETE FROM crm_message_templates WHERE workspace_id = $1 AND id = $2`, [ctx.workspace.id, templateId]);
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
      text: `INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, prospect_id, actor_profile_id, type, payload)
             SELECT $1, id, establishment_id, prospect_id, $3, 'stage.changed', $4::jsonb FROM crm_deals WHERE workspace_id = $1 AND stage_id = $2`,
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

