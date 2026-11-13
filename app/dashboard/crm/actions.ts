"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { cleanEmail, cleanPhone, cleanText, isUuid, parseAmountToCents, parseDateOnly, parseLocalDateTime, uuidList } from "@/lib/crm/input";
import { isStageKind } from "@/lib/crm/pipeline";
import { isCrmRole } from "@/lib/crm/permissions";
import {
  CrmError,
  addContact,
  addMemberByEmail,
  addNote,
  addStage,
  addTask,
  changeMember,
  createDeals,
  createTeamWorkspace,
  deleteContact,
  deleteDeal,
  deleteDeals,
  dealsWithHistory,
  moveDeals,
  setDealsArchived,
  type BulkResult,
  listMyWorkspaces,
  moveDeal,
  removeStage,
  reorderStage,
  saveStage,
  setTaskStatus,
  updateDeal
} from "@/lib/crm/repository";
import { getCrmSession, rememberWorkspace } from "@/lib/crm/server";
import { safeReturnTo, withParams } from "@/lib/crm/navigation";
import { isDealSource } from "@/lib/crm/timeline";
import type { DealSource } from "@/lib/crm/types";
import { isPriority, type DealPriority } from "@/lib/crm/prospects";

/**
 * Server actions do CRM. Padrão de todas:
 *   1. sessão + workspace resolvidos no servidor (getCrmSession);
 *   2. entrada normalizada (lib/crm/input);
 *   3. permissão verificada no repositório (lib/crm/permissions);
 *   4. histórico gravado na mesma transação da mudança.
 */

function revalidateCrm(dealId?: string) {
  revalidatePath("/dashboard/crm");
  if (dealId) revalidatePath(`/dashboard/crm/${dealId}`);
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/companies/[cnpj]", "page");
}

async function session() {
  const current = await getCrmSession();
  if (!current) redirect("/sign-in");
  return current;
}

/** Executa a operação e redireciona com feedback; erros de domínio viram mensagem. */
async function run(returnTo: string, operation: () => Promise<string>) {
  let status = "";
  try {
    status = await operation();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CrmError) redirect(withParams(returnTo, { error: error.code, detail: error.message }));
    console.error("[crm] falha na operação", { message: error instanceof Error ? error.message : String(error) });
    redirect(withParams(returnTo, { error: "unavailable" }));
  }
  redirect(withParams(returnTo, { status }));
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export async function switchWorkspaceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), "/dashboard/crm");
  const mine = await listMyWorkspaces(user.id);
  if (isUuid(workspaceId) && mine.some((workspace) => workspace.id === workspaceId)) {
    await rememberWorkspace(workspaceId);
  }
  revalidateCrm();
  redirect(withParams(returnTo.split("?")[0], { status: "workspace-trocado" }));
}

// ---------------------------------------------------------------------------
// Empresa / lista → CRM
// ---------------------------------------------------------------------------

export async function addCompanyToCrmAction(formData: FormData) {
  const { ctx } = await session();
  const establishmentId = String(formData.get("establishmentId") ?? "").toLowerCase();
  const sourceValue = String(formData.get("source") ?? "company");
  const source: DealSource = isDealSource(sourceValue) ? sourceValue : "company";
  const returnTo = safeReturnTo(formData.get("returnTo"), "/dashboard/crm");
  await run(returnTo, async () => {
    if (!isUuid(establishmentId)) throw new CrmError("invalid", "Nenhuma empresa válida selecionada.");
    const result = await createDeals(ctx, [establishmentId], { source, ownerProfileId: ctx.profileId });
    revalidateCrm(result.dealIds[0] ?? result.existingDealIds[0]);
    if (result.created) return "deal-criado";
    if (result.restored) return "deal-restaurado";
    return "deal-existente";
  });
}

/** Lista de prospecção (Fase 5) → CRM. Só listas do próprio usuário. */
export async function sendListToCrmAction(formData: FormData) {
  const { ctx } = await session();
  const listId = String(formData.get("listId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), "/dashboard/leads");
  await run(returnTo, async () => {
    if (!isUuid(listId)) throw new CrmError("invalid", "Nenhuma empresa válida selecionada.");
    const db = createDbClient();
    const { data: list } = await db.from("saved_lead_lists").select("id,name").eq("id", listId).eq("profile_id", ctx.profileId).maybeSingle();
    if (!list) throw new CrmError("not_found", "Nenhuma empresa válida selecionada.");
    const { data: rows } = await db.from("saved_establishments").select("establishment_id").eq("profile_id", ctx.profileId).eq("list_id", listId);
    const ids = uuidList((rows ?? []).map((row) => row.establishment_id));
    if (!ids.length) throw new CrmError("invalid", "Nenhuma empresa válida selecionada.");
    await createDeals(ctx, ids, { source: "list", sourceRef: listId, sourceLabel: String(list.name ?? ""), ownerProfileId: ctx.profileId, requireVisible: true });
    revalidateCrm();
    return "lista-enviada";
  });
}

/**
 * Seleção da tabela de resultados → CRM (chamada direta do componente cliente).
 * Retorna contagens em vez de redirecionar.
 */
export type SendToCrmResult = { ok: boolean; created: number; alreadyInCrm: number; savedNew: number; restored: number; message?: string; error?: string };

/** Mensagem única para "Enviar ao CRM" (busca, mapa, leads salvos, ficha). */
function sendToCrmMessage(result: { created: number; alreadyInCrm: number; restored: number; requested: number }) {
  if (result.requested === 1) {
    if (result.created) return "Lead adicionado ao CRM e aos leads salvos.";
    if (result.restored) return "Lead restaurado no CRM e mantido nos leads salvos.";
    return "Este lead já estava no CRM; ele foi mantido nos leads salvos, sem duplicação.";
  }
  const parts = [`${result.created} lead(s) adicionado(s) ao CRM e aos leads salvos.`];
  if (result.restored) parts.push(`${result.restored} arquivado(s) restaurado(s).`);
  const already = result.alreadyInCrm - result.restored;
  if (already > 0) parts.push(`${already} já estava(m) no CRM (sem duplicação).`);
  return parts.join(" ");
}

async function sendEstablishments(establishmentIds: string[], source: DealSource, sourceRef: string | null): Promise<SendToCrmResult> {
  const failed = (error: string): SendToCrmResult => ({ ok: false, created: 0, alreadyInCrm: 0, savedNew: 0, restored: 0, error });
  const current = await getCrmSession().catch(() => null);
  if (!current) return failed("Faça login para usar o CRM.");
  const ids = uuidList(establishmentIds);
  if (!ids.length) return failed("Nenhuma empresa válida selecionada.");
  try {
    const result = await createDeals(current.ctx, ids, { source, sourceRef, ownerProfileId: current.ctx.profileId, requireVisible: true });
    if (!result.requested) return failed("Nenhuma empresa liberada para você foi selecionada.");
    revalidateCrm();
    revalidatePath("/dashboard", "layout");
    return { ok: true, created: result.created, alreadyInCrm: result.alreadyInCrm, savedNew: result.savedNew, restored: result.restored, message: sendToCrmMessage(result) };
  } catch (error) {
    console.error("[crm] falha ao enviar seleção", { message: error instanceof Error ? error.message : String(error) });
    return failed(error instanceof CrmError ? error.message : "Não foi possível enviar ao CRM agora.");
  }
}

export async function sendSearchSelectionToCrm(searchId: string | null, establishmentIds: string[]): Promise<SendToCrmResult> {
  return sendEstablishments(establishmentIds, "search", isUuid(searchId) ? searchId : null);
}

/** Mapa empresarial → CRM (chamada do painel da empresa no mapa). */
export async function sendMapCompanyToCrm(searchId: string | null, establishmentId: string): Promise<SendToCrmResult> {
  return sendEstablishments([establishmentId], "map", isUuid(searchId) ? searchId : null);
}

// ---------------------------------------------------------------------------
// Ações em lote da listagem (Fase 9) — chamadas do cliente, sem redirect: a tela
// chama router.refresh() e mantém a mesma URL (filtros, busca e página preservados).
// ---------------------------------------------------------------------------

export type BulkDealsInput =
  | { op: "archive" | "restore"; dealIds: string[] }
  | { op: "delete"; dealIds: string[]; force?: boolean }
  | { op: "move"; dealIds: string[]; stageId: string };

export type BulkDealsResponse = { ok: boolean; message: string; tone: "success" | "warning" | "danger"; result?: BulkResult };

function bulkMessage(op: BulkDealsInput["op"], result: BulkResult) {
  const verb = { archive: "arquivado(s)", restore: "restaurado(s)", delete: "excluído(s)", move: "movido(s)" }[op];
  const parts = [`${result.done.length} prospect(s) ${verb}.`];
  if (result.hasHistory.length) parts.push(`${result.hasHistory.length} com histórico comercial não foi(ram) excluído(s): arquive ou confirme a exclusão definitiva.`);
  if (result.forbidden.length) parts.push(`${result.forbidden.length} sem permissão (somente o responsável ou um administrador).`);
  if (result.failed.length) parts.push(`${result.failed.length} não processado(s) por falha temporária; tente novamente.`);
  if (result.notFound.length) parts.push(`${result.notFound.length} não encontrado(s) neste workspace.`);
  return parts.join(" ");
}

export async function bulkDealsAction(input: BulkDealsInput): Promise<BulkDealsResponse> {
  const current = await getCrmSession().catch(() => null);
  if (!current) return { ok: false, tone: "danger", message: "Sessão expirada. Entre novamente." };
  const ids = Array.isArray(input?.dealIds) ? input.dealIds.map(String) : [];
  try {
    let result: BulkResult;
    if (input.op === "archive" || input.op === "restore") result = await setDealsArchived(current.ctx, ids, input.op === "archive");
    else if (input.op === "delete") result = await deleteDeals(current.ctx, ids, { force: input.force === true });
    else if (input.op === "move") result = await moveDeals(current.ctx, ids, String(input.stageId ?? ""));
    else return { ok: false, tone: "danger", message: "Ação inválida." };
    revalidateCrm();
    const clean = !result.forbidden.length && !result.notFound.length && !result.hasHistory.length && !result.failed.length;
    return { ok: result.done.length > 0 || clean, tone: clean ? "success" : result.done.length ? "warning" : "danger", message: bulkMessage(input.op, result), result };
  } catch (error) {
    if (!(error instanceof CrmError)) console.error("[crm] falha na ação em lote", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, tone: "danger", message: error instanceof CrmError ? error.message : "Não foi possível concluir agora. Recarregue a lista para conferir o estado atual." };
  }
}

/** Negócios com histórico comercial (para a confirmação de exclusão avisar antes). */
export async function dealsHistoryCheck(dealIds: string[]): Promise<{ ok: boolean; withHistory: string[] }> {
  const current = await getCrmSession().catch(() => null);
  if (!current) return { ok: false, withHistory: [] };
  try {
    const set = await dealsWithHistory(current.ctx, uuidList(dealIds).slice(0, 200));
    return { ok: true, withHistory: [...set] };
  } catch {
    return { ok: false, withHistory: [] };
  }
}

// ---------------------------------------------------------------------------
// Negócio
// ---------------------------------------------------------------------------

/** Drag & drop do Kanban (chamada do cliente, sem redirect). */
export async function moveDealAction(dealId: string, toStageId: string, toIndex: number): Promise<{ ok: boolean; error?: string }> {
  const current = await getCrmSession().catch(() => null);
  if (!current) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (!isUuid(dealId) || !isUuid(toStageId)) return { ok: false, error: "Movimento inválido." };
  try {
    await moveDeal(current.ctx, dealId, toStageId, Number.isFinite(toIndex) ? toIndex : 0);
    revalidateCrm(dealId);
    return { ok: true };
  } catch (error) {
    if (!(error instanceof CrmError)) console.error("[crm] falha ao mover", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: error instanceof CrmError ? error.message : "Não foi possível mover agora." };
  }
}

/** Fallback sem JavaScript / mobile: mover pelo seletor de etapa. */
export async function moveDealFormAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), "/dashboard/crm");
  await run(returnTo, async () => {
    if (!isUuid(dealId) || !isUuid(stageId)) throw new CrmError("invalid", "Etapa inválida.");
    await moveDeal(ctx, dealId, stageId, 0);
    revalidateCrm(dealId);
    return "deal-atualizado";
  });
}

export async function updateDealAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), `/dashboard/crm/${dealId}`);
  await run(returnTo, async () => {
    if (!isUuid(dealId)) throw new CrmError("invalid", "Etapa inválida.");
    const amount = formData.has("amount") ? parseAmountToCents(formData.get("amount")) : undefined;
    if (formData.has("amount") && amount === undefined) throw new CrmError("invalid", "Valor inválido. Use o formato 12.500,00.");
    const owner = formData.has("ownerProfileId") ? String(formData.get("ownerProfileId") ?? "") : undefined;
    await updateDeal(ctx, dealId, {
      title: formData.has("title") ? cleanText(formData.get("title"), 160) : undefined,
      amountCents: amount,
      expectedCloseDate: formData.has("expectedCloseDate") ? parseDateOnly(formData.get("expectedCloseDate")) : undefined,
      lostReason: formData.has("lostReason") ? cleanText(formData.get("lostReason"), 500) : undefined,
      priority: formData.has("priority") && isPriority(formData.get("priority")) ? (String(formData.get("priority")) as DealPriority) : undefined,
      stageId: formData.has("stageId") && isUuid(formData.get("stageId")) ? String(formData.get("stageId")) : undefined,
      ownerProfileId: owner === undefined ? undefined : isUuid(owner) ? owner : null,
      primaryContactId: formData.has("primaryContactId") ? (isUuid(formData.get("primaryContactId")) ? String(formData.get("primaryContactId")) : null) : undefined
    });
    revalidateCrm(dealId);
    return "deal-atualizado";
  });
}

export async function deleteDealAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  await run("/dashboard/crm", async () => {
    if (!isUuid(dealId)) throw new CrmError("invalid", "Etapa inválida.");
    // Com histórico comercial, a exclusão exige a confirmação explícita do formulário.
    const removed = await deleteDeal(ctx, dealId, { force: formData.get("confirmHistory") === "1" });
    revalidateCrm(dealId);
    return removed.kind === "prospect" ? "prospect-removido" : "deal-removido";
  });
}

/** Arquivar / restaurar pela página do negócio (formulário, com redirect e feedback). */
export async function setDealArchivedAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  const archive = formData.get("archive") === "1";
  await run(`/dashboard/crm/${isUuid(dealId) ? dealId : ""}`, async () => {
    if (!isUuid(dealId)) throw new CrmError("invalid", "Nenhum negócio válido selecionado.");
    const result = await setDealsArchived(ctx, [dealId], archive);
    if (result.forbidden.length) throw new CrmError("forbidden", "Somente o responsável ou um administrador pode arquivar este negócio.");
    if (result.notFound.length) throw new CrmError("not_found", "Negócio não encontrado neste workspace.");
    revalidateCrm(dealId);
    return archive ? "deal-arquivado" : "deal-restaurado-manual";
  });
}

// ---------------------------------------------------------------------------
// Notas, tarefas, contatos
// ---------------------------------------------------------------------------

export async function addNoteAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  await run(`/dashboard/crm/${isUuid(dealId) ? dealId : ""}`, async () => {
    const body = cleanText(formData.get("body"), 5000);
    if (!isUuid(dealId) || !body) throw new CrmError("invalid", "Informe o texto da nota.");
    await addNote(ctx, dealId, body);
    revalidateCrm(dealId);
    return "nota-criada";
  });
}

export async function addTaskAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  await run(`/dashboard/crm/${isUuid(dealId) ? dealId : ""}`, async () => {
    const title = cleanText(formData.get("title"), 200);
    if (!isUuid(dealId) || !title) throw new CrmError("invalid", "Informe o título da tarefa.");
    const assignee = String(formData.get("assigneeProfileId") ?? "");
    await addTask(ctx, dealId, { title, dueAt: parseLocalDateTime(formData.get("dueAt")), assigneeProfileId: isUuid(assignee) ? assignee : null });
    revalidateCrm(dealId);
    return "tarefa-criada";
  });
}

export async function toggleTaskAction(formData: FormData) {
  const { ctx } = await session();
  const taskId = String(formData.get("taskId") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"), "/dashboard/crm");
  await run(returnTo, async () => {
    await setTaskStatus(ctx, taskId, formData.get("done") === "1");
    revalidateCrm();
    return "tarefa-atualizada";
  });
}

export async function addContactAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  await run(`/dashboard/crm/${isUuid(dealId) ? dealId : ""}`, async () => {
    const name = cleanText(formData.get("name"), 120);
    if (!isUuid(dealId) || !name) throw new CrmError("invalid", "Informe o nome do contato.");
    const email = cleanEmail(formData.get("email"));
    if (email === undefined) throw new CrmError("invalid", "E-mail inválido.");
    await addContact(ctx, dealId, {
      name,
      jobTitle: cleanText(formData.get("jobTitle"), 120),
      email,
      phone: cleanPhone(formData.get("phone")),
      whatsapp: cleanPhone(formData.get("whatsapp")),
      makePrimary: formData.get("makePrimary") === "1"
    });
    revalidateCrm(dealId);
    return "contato-criado";
  });
}

export async function deleteContactAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  await run(`/dashboard/crm/${isUuid(dealId) ? dealId : ""}`, async () => {
    if (!isUuid(dealId) || !isUuid(contactId)) throw new CrmError("invalid", "Contato inválido para esta empresa.");
    await deleteContact(ctx, dealId, contactId);
    revalidateCrm(dealId);
    return "contato-removido";
  });
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const SETTINGS = "/dashboard/crm/configuracoes";

export async function saveStageAction(formData: FormData) {
  const { ctx } = await session();
  await run(SETTINGS, async () => {
    const stageId = String(formData.get("stageId") ?? "");
    const kind = String(formData.get("kind") ?? "open");
    if (!isUuid(stageId) || !isStageKind(kind)) throw new CrmError("invalid", "Etapa inválida.");
    await saveStage(ctx, stageId, { name: String(formData.get("name") ?? ""), kind });
    revalidateCrm();
    return "pipeline-salvo";
  });
}

export async function addStageAction(formData: FormData) {
  const { ctx } = await session();
  await run(SETTINGS, async () => {
    const kind = String(formData.get("kind") ?? "open");
    if (!isStageKind(kind)) throw new CrmError("invalid", "Etapa inválida.");
    await addStage(ctx, { name: String(formData.get("name") ?? ""), kind });
    revalidateCrm();
    return "pipeline-salvo";
  });
}

export async function reorderStageAction(formData: FormData) {
  const { ctx } = await session();
  await run(SETTINGS, async () => {
    const stageId = String(formData.get("stageId") ?? "");
    const direction = formData.get("direction") === "up" ? "up" : "down";
    if (!isUuid(stageId)) throw new CrmError("invalid", "Etapa inválida.");
    await reorderStage(ctx, stageId, direction);
    revalidateCrm();
    return "pipeline-salvo";
  });
}

export async function removeStageAction(formData: FormData) {
  const { ctx } = await session();
  await run(SETTINGS, async () => {
    const stageId = String(formData.get("stageId") ?? "");
    const moveTo = String(formData.get("moveDealsTo") ?? "");
    if (!isUuid(stageId)) throw new CrmError("invalid", "Etapa inválida.");
    await removeStage(ctx, stageId, isUuid(moveTo) ? moveTo : null);
    revalidateCrm();
    return "pipeline-salvo";
  });
}

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

export async function createTeamAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  await run(SETTINGS, async () => {
    const name = cleanText(formData.get("name"), 120);
    if (!name) throw new CrmError("invalid", "Informe o nome da equipe.");
    const workspaceId = await createTeamWorkspace(user.id, name);
    if (workspaceId) await rememberWorkspace(workspaceId);
    revalidateCrm();
    return "equipe-criada";
  });
}

export async function addMemberAction(formData: FormData) {
  const { ctx } = await session();
  await run(SETTINGS, async () => {
    const email = cleanEmail(formData.get("email"));
    const role = String(formData.get("role") ?? "member");
    if (!email) throw new CrmError("invalid", "Informe um e-mail válido.");
    if (!isCrmRole(role)) throw new CrmError("invalid", "Sem permissão para adicionar membros com esse papel.");
    const result = await addMemberByEmail(ctx, email, role);
    revalidateCrm();
    return result.added ? "membro-adicionado" : "membro-nao-encontrado";
  });
}

export async function changeMemberAction(formData: FormData) {
  const { ctx } = await session();
  await run(SETTINGS, async () => {
    const profileId = String(formData.get("profileId") ?? "");
    const next = String(formData.get("next") ?? "");
    if (!isUuid(profileId) || !(next === "remove" || isCrmRole(next))) throw new CrmError("invalid", "Sem permissão para alterar este membro.");
    await changeMember(ctx, profileId, next as "remove");
    revalidateCrm();
    return "membro-atualizado";
  });
}
