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
  listMyWorkspaces,
  moveDeal,
  removeStage,
  reorderStage,
  saveStage,
  setTaskStatus,
  updateDeal
} from "@/lib/crm/repository";
import { getCrmSession, rememberWorkspace } from "@/lib/crm/server";
import { isDealSource } from "@/lib/crm/timeline";
import type { DealSource } from "@/lib/crm/types";

/**
 * Server actions do CRM. Padrão de todas:
 *   1. sessão + workspace resolvidos no servidor (getCrmSession);
 *   2. entrada normalizada (lib/crm/input);
 *   3. permissão verificada no repositório (lib/crm/permissions);
 *   4. histórico gravado na mesma transação da mudança.
 */

function safeReturnTo(value: FormDataEntryValue | null, fallback: string) {
  const path = String(value ?? "");
  return /^\/dashboard(\/[A-Za-z0-9_\-/.%]*)?(\?[A-Za-z0-9_\-=&.%]*)?$/.test(path) && !path.includes("//") ? path : fallback;
}

function withParams(path: string, params: Record<string, string>) {
  const [base, query = ""] = path.split("?");
  const search = new URLSearchParams(query);
  for (const key of ["status", "error", "detail"]) search.delete(key);
  for (const [key, value] of Object.entries(params)) search.set(key, value);
  const text = search.toString();
  return text ? `${base}?${text}` : base;
}

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
    revalidateCrm(result.dealIds[0]);
    return result.created ? "deal-criado" : "deal-existente";
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
    await createDeals(ctx, ids, { source: "list", sourceRef: listId, sourceLabel: String(list.name ?? ""), ownerProfileId: ctx.profileId });
    revalidateCrm();
    return "lista-enviada";
  });
}

/**
 * Seleção da tabela de resultados → CRM (chamada direta do componente cliente).
 * Retorna contagens em vez de redirecionar.
 */
export async function sendSearchSelectionToCrm(
  searchId: string | null,
  establishmentIds: string[]
): Promise<{ ok: boolean; created: number; alreadyInCrm: number; error?: string }> {
  const current = await getCrmSession().catch(() => null);
  if (!current) return { ok: false, created: 0, alreadyInCrm: 0, error: "Faça login para usar o CRM." };
  const ids = uuidList(establishmentIds);
  if (!ids.length) return { ok: false, created: 0, alreadyInCrm: 0, error: "Nenhuma empresa válida selecionada." };
  try {
    const result = await createDeals(current.ctx, ids, {
      source: "search",
      sourceRef: isUuid(searchId) ? searchId : null,
      ownerProfileId: current.ctx.profileId
    });
    revalidateCrm();
    return { ok: true, created: result.created, alreadyInCrm: result.alreadyInCrm };
  } catch (error) {
    console.error("[crm] falha ao enviar seleção", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, created: 0, alreadyInCrm: 0, error: error instanceof CrmError ? error.message : "Não foi possível enviar ao CRM agora." };
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
    await deleteDeal(ctx, dealId);
    revalidateCrm(dealId);
    return "deal-removido";
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
