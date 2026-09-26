import type { CrmRole } from "./types";

/**
 * Permissões do CRM — funções puras, testáveis e usadas em TODA server action.
 *
 * Isolamento entre organizações não depende destas funções: ele vem do escopo
 * `workspace_id` obrigatório em cada consulta (ver lib/crm/repository.ts) e das FKs
 * compostas no banco. Estas regras decidem o que cada papel pode fazer DENTRO
 * do próprio workspace.
 *
 *   owner  — tudo, inclusive equipe e pipeline; único que exclui o workspace.
 *   admin  — tudo no CRM, pipeline e membros (exceto mexer no owner).
 *   member — vê todos os negócios do workspace; edita os seus e os sem responsável;
 *            pode assumir um negócio sem responsável; não reatribui o de outra pessoa.
 */

export type Actor = { profileId: string; role: CrmRole };
export type DealAccess = { ownerProfileId: string | null; createdBy?: string | null };

const RANK: Record<CrmRole, number> = { member: 1, admin: 2, owner: 3 };

export function isCrmRole(value: unknown): value is CrmRole {
  return value === "owner" || value === "admin" || value === "member";
}

export const ROLE_LABEL: Record<CrmRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  member: "Membro"
};

function isManager(actor: Actor) {
  return RANK[actor.role] >= RANK.admin;
}

export function canViewDeals(actor: Actor | null) {
  return Boolean(actor);
}

export function canCreateDeal(actor: Actor | null) {
  return Boolean(actor);
}

export function canEditDeal(actor: Actor, deal: DealAccess) {
  if (isManager(actor)) return true;
  return deal.ownerProfileId === null || deal.ownerProfileId === actor.profileId;
}

/** Mover no Kanban = editar a etapa. */
export const canMoveDeal = canEditDeal;

export function canDeleteDeal(actor: Actor, deal: DealAccess) {
  if (isManager(actor)) return true;
  return deal.ownerProfileId === actor.profileId && (deal.createdBy ?? actor.profileId) === actor.profileId;
}

/**
 * Troca de responsável. Membro só pode assumir um negócio sem responsável
 * (ou devolvê-lo, se for o dele). O novo responsável deve ser membro do workspace.
 */
export function canAssignDeal(actor: Actor, deal: DealAccess, nextOwnerId: string | null, memberIds: ReadonlySet<string>) {
  if (nextOwnerId !== null && !memberIds.has(nextOwnerId)) return false;
  if (isManager(actor)) return true;
  if (deal.ownerProfileId === null) return nextOwnerId === actor.profileId;
  if (deal.ownerProfileId === actor.profileId) return nextOwnerId === null || nextOwnerId === actor.profileId;
  return false;
}

/** Nota e tarefa: qualquer membro que enxerga o negócio pode registrar atividade nele. */
export function canAddActivity(actor: Actor | null) {
  return Boolean(actor);
}

export function canUpdateTask(actor: Actor, task: { assigneeProfileId: string | null; createdBy: string | null }, deal: DealAccess) {
  if (isManager(actor)) return true;
  return [task.assigneeProfileId, task.createdBy, deal.ownerProfileId].includes(actor.profileId);
}

export function canManageContacts(actor: Actor | null) {
  return Boolean(actor);
}

export function canConfigurePipeline(actor: Actor) {
  return isManager(actor);
}

export function canManageMembers(actor: Actor) {
  return isManager(actor);
}

/** Alterar papel/remover alguém: ninguém mexe no owner; admin não promove a owner. */
export function canChangeMember(actor: Actor, target: { profileId: string; role: CrmRole }, nextRole: CrmRole | "remove") {
  if (!isManager(actor)) {
    // Membro pode apenas sair do workspace (remover a si mesmo).
    return nextRole === "remove" && target.profileId === actor.profileId && target.role !== "owner";
  }
  if (target.role === "owner") return false;
  if (nextRole === "owner") return false;
  if (actor.role === "admin" && target.role === "admin" && target.profileId !== actor.profileId) return false;
  return true;
}

export function canDeleteWorkspace(actor: Actor, workspace: { isPersonal: boolean }) {
  return actor.role === "owner" && !workspace.isPersonal;
}
