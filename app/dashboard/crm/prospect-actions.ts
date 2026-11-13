"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { cleanText, isUuid, parseLocalDateTime } from "@/lib/crm/input";
import { parseDealFields, parseDocument, parseProspectInput, type ProspectKind } from "@/lib/crm/prospects";
import {
  CrmError,
  createManualDeal,
  deleteTemplate,
  findDuplicates,
  logInteraction,
  saveTemplate,
  scheduleNextContact,
  updateProspect,
  type DuplicateReport
} from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";
import { safeReturnTo, withParams } from "@/lib/crm/navigation";
import { validateTemplate } from "@/lib/crm/templates";
import { isInteractionChannel, isInteractionOutcome } from "@/lib/crm/timeline";

/**
 * Server actions da Fase 8 (prospects manuais, interações e modelos de mensagem).
 * Mesmo padrão de app/dashboard/crm/actions.ts: sessão + workspace no servidor,
 * entrada normalizada, permissão no repositório, histórico na mesma transação.
 */

function revalidateCrm(dealId?: string) {
  revalidatePath("/dashboard/crm");
  if (dealId) revalidatePath(`/dashboard/crm/${dealId}`);
  revalidatePath("/dashboard/leads");
}

async function session() {
  const current = await getCrmSession();
  if (!current) redirect("/sign-in");
  return current;
}

async function run(errorPath: string, operation: () => Promise<string>) {
  let target = "";
  try {
    target = await operation();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CrmError) redirect(withParams(errorPath, { error: error.code, detail: error.message }));
    console.error("[crm] falha na operação", { message: error instanceof Error ? error.message : String(error) });
    redirect(withParams(errorPath, { error: "unavailable" }));
  }
  redirect(target);
}

const formGetter = (formData: FormData) => (key: string) => formData.get(key);

// ---------------------------------------------------------------------------
// Cadastro / edição
// ---------------------------------------------------------------------------

/** Estado do formulário (useActionState): o erro volta sem recarregar, preservando o que foi digitado. */
export type ProspectFormState = { error: string | null };

function formError(error: unknown): ProspectFormState {
  unstable_rethrow(error);
  if (error instanceof CrmError) return { error: error.message };
  console.error("[crm] falha ao salvar prospect", { message: error instanceof Error ? error.message : String(error) });
  return { error: "Não foi possível salvar agora. Tente novamente em instantes." };
}

export async function createProspectAction(_previous: ProspectFormState, formData: FormData): Promise<ProspectFormState> {
  const { ctx } = await session();
  let target = "";
  try {
    const parsed = parseProspectInput(formGetter(formData));
    if (!parsed.ok) return { error: parsed.error };
    const deal = parseDealFields(formGetter(formData));
    if (!deal.ok) return { error: deal.error };
    const link = String(formData.get("linkEstablishmentId") ?? "");
    const result = await createManualDeal(ctx, parsed.prospect, deal.deal, { linkEstablishmentId: isUuid(link) ? link : null });
    revalidateCrm(result.dealId);
    target = withParams(`/dashboard/crm/${result.dealId}`, { status: result.linked ? "prospect-vinculado" : "prospect-criado" });
  } catch (error) {
    return formError(error);
  }
  redirect(target);
}

export async function updateProspectAction(_previous: ProspectFormState, formData: FormData): Promise<ProspectFormState> {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  try {
    if (!isUuid(dealId)) return { error: "Prospect não encontrado." };
    const parsed = parseProspectInput(formGetter(formData));
    if (!parsed.ok) return { error: parsed.error };
    await updateProspect(ctx, dealId, parsed.prospect);
    revalidateCrm(dealId);
  } catch (error) {
    return formError(error);
  }
  redirect(withParams(`/dashboard/crm/${dealId}`, { status: "prospect-atualizado" }));
}

export type DuplicateCheckResult = { ok: true; report: DuplicateReport; documentError: string | null } | { ok: false; error: string };

/**
 * Verificação de duplicidade enquanto o usuário preenche (chamada do cliente).
 * Retorna só o necessário para decidir: ids de negócio, nomes e o motivo.
 */
export async function checkProspectDuplicates(input: {
  kind: ProspectKind;
  document: string;
  phones: string[];
  email: string;
  ignoreDealProspectId?: string | null;
}): Promise<DuplicateCheckResult> {
  const current = await getCrmSession().catch(() => null);
  if (!current) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const kind: ProspectKind = input?.kind === "person" ? "person" : "company";
  const document = parseDocument(kind, String(input?.document ?? "").slice(0, 30));
  const email = String(input?.email ?? "").trim().toLowerCase().slice(0, 254);
  const phones = (Array.isArray(input?.phones) ? input.phones : []).slice(0, 4).map((phone) => String(phone ?? "").slice(0, 40));
  try {
    const report = await findDuplicates(current.ctx, {
      documentType: document.ok ? document.type : null,
      document: document.ok ? document.value : null,
      phones,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      ignoreProspectId: isUuid(input?.ignoreDealProspectId) ? input.ignoreDealProspectId : null
    });
    return { ok: true, report, documentError: document.ok ? null : document.error };
  } catch (error) {
    console.error("[crm] falha ao verificar duplicidade", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "Não foi possível verificar duplicidades agora." };
  }
}

// ---------------------------------------------------------------------------
// Histórico comercial
// ---------------------------------------------------------------------------

export async function logInteractionAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  // Ação rápida da listagem volta para a própria listagem (filtros e página preservados).
  const self = safeReturnTo(formData.get("returnTo"), `/dashboard/crm/${isUuid(dealId) ? dealId : ""}`);
  await run(self, async () => {
    if (!isUuid(dealId)) throw new CrmError("not_found", "Registro não encontrado.");
    const channel = String(formData.get("channel") ?? "");
    if (!isInteractionChannel(channel)) throw new CrmError("invalid", "Canal inválido.");
    const outcome = String(formData.get("outcome") ?? "");
    const occurredRaw = String(formData.get("occurredAt") ?? "").trim();
    const occurredAt = occurredRaw ? parseLocalDateTime(occurredRaw) : null;
    if (occurredRaw && !occurredAt) throw new CrmError("invalid", "Informe uma data válida para o contato.");
    if (occurredAt && Date.parse(occurredAt) > Date.now() + 5 * 60_000) throw new CrmError("invalid", "Informe um contato que já aconteceu (data no passado).");
    const nextRaw = String(formData.get("nextContactAt") ?? "").trim();
    const nextContactAt = nextRaw ? parseLocalDateTime(nextRaw) : null;
    if (nextRaw && !nextContactAt) throw new CrmError("invalid", "Data do próximo contato inválida.");
    await logInteraction(ctx, dealId, {
      channel,
      outcome: isInteractionOutcome(outcome) ? outcome : null,
      occurredAt,
      summary: cleanText(formData.get("summary"), 1000),
      completeNextContact: formData.get("completeNextContact") === "1",
      nextContactAt: nextContactAt ?? undefined
    });
    revalidateCrm(dealId);
    return withParams(self, { status: "interacao-registrada" });
  });
}

/** Registro explícito feito no compositor do WhatsApp, depois que o usuário abriu a conversa. */
export async function logWhatsappContact(dealId: string, summary: string): Promise<{ ok: boolean; error?: string }> {
  const current = await getCrmSession().catch(() => null);
  if (!current) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (!isUuid(dealId)) return { ok: false, error: "Negócio inválido." };
  try {
    await logInteraction(current.ctx, dealId, {
      channel: "whatsapp",
      outcome: "done",
      occurredAt: null,
      summary: cleanText(summary, 1000),
      completeNextContact: false
    });
    revalidateCrm(dealId);
    return { ok: true };
  } catch (error) {
    if (!(error instanceof CrmError)) console.error("[crm] falha ao registrar WhatsApp", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: error instanceof CrmError ? error.message : "Não foi possível registrar agora." };
  }
}

export async function scheduleNextContactAction(formData: FormData) {
  const { ctx } = await session();
  const dealId = String(formData.get("dealId") ?? "");
  const self = safeReturnTo(formData.get("returnTo"), `/dashboard/crm/${isUuid(dealId) ? dealId : ""}`);
  await run(self, async () => {
    if (!isUuid(dealId)) throw new CrmError("not_found", "Registro não encontrado.");
    const clear = formData.get("clear") === "1";
    const raw = String(formData.get("nextContactAt") ?? "").trim();
    const at = clear ? null : parseLocalDateTime(raw);
    if (!clear && !at) throw new CrmError("invalid", "Data do próximo contato inválida.");
    await scheduleNextContact(ctx, dealId, at);
    revalidateCrm(dealId);
    return withParams(self, { status: "proximo-contato" });
  });
}

// ---------------------------------------------------------------------------
// Modelos de mensagem
// ---------------------------------------------------------------------------

const SETTINGS = "/dashboard/crm/configuracoes";

export async function saveTemplateAction(formData: FormData) {
  const { ctx } = await session();
  await run(`${SETTINGS}#modelos`, async () => {
    const templateId = String(formData.get("templateId") ?? "");
    const valid = validateTemplate({ name: formData.get("name"), body: formData.get("body") });
    if (!valid.ok) throw new CrmError("invalid", valid.error);
    await saveTemplate(ctx, isUuid(templateId) ? templateId : null, { name: valid.name, body: valid.body });
    revalidatePath(SETTINGS);
    revalidatePath("/dashboard/crm/[dealId]", "page");
    return withParams(SETTINGS, { status: "modelo-salvo" });
  });
}

export async function deleteTemplateAction(formData: FormData) {
  const { ctx } = await session();
  await run(SETTINGS, async () => {
    const templateId = String(formData.get("templateId") ?? "");
    await deleteTemplate(ctx, templateId);
    revalidatePath(SETTINGS);
    revalidatePath("/dashboard/crm/[dealId]", "page");
    return withParams(SETTINGS, { status: "modelo-removido" });
  });
}
