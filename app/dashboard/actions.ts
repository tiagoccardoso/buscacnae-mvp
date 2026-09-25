"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db-client";
import { getCurrentUser } from "@/lib/auth/server";
import { extractSingleObject } from "@/lib/utils";
import { buildDisplayEstablishment } from "@/lib/establishment-presenter";
import { deriveEnrichmentFacts } from "@/lib/prospecting/enrichment";
import { normalizeScoreCriteria } from "@/lib/prospecting/score";
import type { ProspectingStage } from "@/lib/prospecting/types";

export async function toggleSavedEstablishmentAction(formData: FormData) {
  const establishmentId = String(formData.get("establishmentId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  if (!establishmentId || !["save", "remove"].includes(intent)) {
    return;
  }


  if (intent === "save") {
    await db.from("saved_establishments").upsert(
      {
        profile_id: user.id,
        establishment_id: establishmentId
      },
      {
        onConflict: "profile_id,establishment_id"
      }
    );
  } else {
    await db
      .from("saved_establishments")
      .delete()
      .eq("profile_id", user.id)
      .eq("establishment_id", establishmentId);
  }

  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/leads");
}

// Ids de establishments (uuid no schema atual); aceita apenas caracteres seguros.
const ESTABLISHMENT_ID_PATTERN = /^[0-9a-zA-Z-]{1,64}$/;
const MAX_BULK_SAVE = 1000;

/**
 * Salva na carteira, em lote, as empresas selecionadas na tabela de resultados.
 * Idempotente (ON CONFLICT) e em lotes de 500 para não estourar o limite de parâmetros.
 */
export async function saveSelectedEstablishmentsAction(establishmentIds: string[]): Promise<{ ok: boolean; saved: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, saved: 0, error: "Faça login para salvar empresas." };
  }

  const ids = Array.from(new Set((Array.isArray(establishmentIds) ? establishmentIds : []).map((id) => String(id).trim())))
    .filter((id) => ESTABLISHMENT_ID_PATTERN.test(id))
    .slice(0, MAX_BULK_SAVE);

  if (ids.length === 0) {
    return { ok: false, saved: 0, error: "Nenhuma empresa válida selecionada." };
  }

  const db = createDbClient();
  for (let index = 0; index < ids.length; index += 500) {
    const part = ids.slice(index, index + 500);
    const { error } = await db
      .from("saved_establishments")
      .upsert(
        part.map((establishmentId) => ({ profile_id: user.id, establishment_id: establishmentId })),
        { onConflict: "profile_id,establishment_id" }
      )
      .select("establishment_id");
    if (error) {
      console.error("[leads] falha ao salvar seleção", { code: error.code ?? null });
      return { ok: false, saved: 0, error: "Não foi possível salvar a seleção agora. Tente novamente." };
    }
  }

  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/leads");
  return { ok: true, saved: ids.length };
}

function uniqueIds(values: FormDataEntryValue[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
}

async function resolveOwnedSearchIds(searchIds: string[], profileId: string) {
  if (searchIds.length === 0) {
    return [] as string[];
  }

  const db = createDbClient();
  const { data, error } = await db
    .from("search_queries")
    .select("id")
    .in("id", searchIds)
    .eq("profile_id", profileId);

  if (error || !data) {
    return [] as string[];
  }

  return data.map((item) => item.id);
}

function revalidateHistoryPaths(searchIds: string[] = []) {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/history");

  for (const searchId of searchIds) {
    revalidatePath(`/dashboard/search/${searchId}`);
  }
}

function revalidateLeadPaths() {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/leads");
}

export async function createSavedLeadListAction(formData: FormData) {
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/dashboard/leads?error=lista-sem-nome");
  }

  const { error } = await db.from("saved_lead_lists").upsert(
    {
      profile_id: user.id,
      name
    },
    { onConflict: "profile_id,name" }
  );

  if (error) {
    console.error("Falha ao criar lista", error);
    redirect("/dashboard/leads?error=lista-duplicada");
  }

  revalidateLeadPaths();
  redirect("/dashboard/leads?status=lista-criada");
}

function parseTags(value: FormDataEntryValue | null) {
  return Array.from(new Set(String(value ?? "").split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 20);
}

function parseIdList(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter((value) => ESTABLISHMENT_ID_PATTERN.test(value)))).slice(0, MAX_BULK_SAVE);
}

export async function createSavedLeadListFromSelectionAction(
  establishmentIds: string[],
  name: string
): Promise<{ ok: boolean; saved: number; error?: string; listId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, saved: 0, error: "Faça login para criar uma lista." };

  const ids = parseIdList(Array.isArray(establishmentIds) ? establishmentIds : []);
  const cleanName = String(name ?? "").trim().slice(0, 120);
  if (!cleanName) return { ok: false, saved: 0, error: "Informe um nome para a lista." };
  if (ids.length === 0) return { ok: false, saved: 0, error: "Nenhuma empresa válida selecionada." };

  const db = createDbClient();
  const { data: ownedEstablishments, error: establishmentError } = await db.from("establishments").select("id").in("id", ids);
  if (establishmentError) return { ok: false, saved: 0, error: "Não foi possível validar a seleção." };
  const validIds = parseIdList(((ownedEstablishments ?? []) as Array<{ id: unknown }>).map((item) => String(item.id ?? "")));
  if (validIds.length === 0) return { ok: false, saved: 0, error: "As empresas selecionadas não estão disponíveis." };

  const { data: list, error: listError } = await db
    .from("saved_lead_lists")
    .upsert({ profile_id: user.id, name: cleanName }, { onConflict: "profile_id,name" })
    .select("id")
    .single();
  if (listError || !list) return { ok: false, saved: 0, error: "Não foi possível criar a lista." };

  const { error: saveError } = await db.from("saved_establishments").upsert(
    validIds.map((establishmentId) => ({ profile_id: user.id, establishment_id: establishmentId, list_id: list.id })),
    { onConflict: "profile_id,establishment_id" }
  );
  if (saveError) return { ok: false, saved: 0, error: "Não foi possível adicionar as empresas à lista." };

  revalidateLeadPaths();
  return { ok: true, saved: validIds.length, listId: String(list.id) };
}

export async function updateSavedLeadListAction(formData: FormData) {
  const user = await getCurrentUser();
  const db = createDbClient();
  if (!user) redirect("/sign-in");

  const listId = String(formData.get("listId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!listId || !name) redirect("/dashboard/leads?error=lista-invalida");

  const criteria = normalizeScoreCriteria({
    targetStates: String(formData.get("targetStates") ?? "").split(","),
    targetCnaeCodes: String(formData.get("targetCnaeCodes") ?? "").split(","),
    targetCompanySizes: String(formData.get("targetCompanySizes") ?? "").split(","),
    minYearsActive: formData.get("minYearsActive"),
    weights: {
      activeStatus: formData.get("weightActiveStatus"),
      companySize: formData.get("weightCompanySize"),
      location: formData.get("weightLocation"),
      cnae: formData.get("weightCnae"),
      tenure: formData.get("weightTenure"),
      digitalPresence: formData.get("weightDigitalPresence")
    }
  });

  const { error } = await db.from("saved_lead_lists").update({
    name,
    description: String(formData.get("description") ?? "").trim().slice(0, 500) || null,
    tags: parseTags(formData.get("tags")),
    score_criteria: criteria,
    updated_at: new Date().toISOString()
  }).eq("id", listId).eq("profile_id", user.id);
  if (error) {
    console.error("Falha ao editar lista", error);
    redirect("/dashboard/leads?error=lista-edicao");
  }
  revalidateLeadPaths();
  redirect(`/dashboard/leads?list=${encodeURIComponent(listId)}&status=lista-editada`);
}

export async function updateSavedEstablishmentMetaAction(formData: FormData) {
  const user = await getCurrentUser();
  const db = createDbClient();
  if (!user) redirect("/sign-in");

  const establishmentId = String(formData.get("establishmentId") ?? "").trim();
  const stage = String(formData.get("stage") ?? "new") as ProspectingStage;
  const validStages: ProspectingStage[] = ["new", "researching", "qualified", "lead", "discarded"];
  if (!ESTABLISHMENT_ID_PATTERN.test(establishmentId) || !validStages.includes(stage)) {
    redirect("/dashboard/leads?error=lead-invalido");
  }

  const { error } = await db.from("saved_establishments").update({
    notes: String(formData.get("notes") ?? "").trim().slice(0, 2000) || null,
    tags: parseTags(formData.get("tags")),
    stage,
    updated_at: new Date().toISOString()
  }).eq("profile_id", user.id).eq("establishment_id", establishmentId);
  if (error) {
    console.error("Falha ao atualizar metadados do lead", error);
    redirect("/dashboard/leads?error=lead-atualizacao");
  }
  revalidateLeadPaths();
  redirect("/dashboard/leads?status=lead-atualizado");
}

export async function removeEstablishmentFromListAction(formData: FormData) {
  const user = await getCurrentUser();
  const db = createDbClient();
  if (!user) redirect("/sign-in");
  const establishmentId = String(formData.get("establishmentId") ?? "").trim();
  if (!ESTABLISHMENT_ID_PATTERN.test(establishmentId)) redirect("/dashboard/leads?error=lead-invalido");
  const { error } = await db.from("saved_establishments").update({ list_id: null, updated_at: new Date().toISOString() }).eq("profile_id", user.id).eq("establishment_id", establishmentId);
  if (error) redirect("/dashboard/leads?error=lista-vinculo");
  revalidateLeadPaths();
  redirect("/dashboard/leads?status=lead-removido");
}

export async function runProspectingEnrichmentAction(formData: FormData) {
  const user = await getCurrentUser();
  const db = createDbClient();
  if (!user) redirect("/sign-in");
  const establishmentId = String(formData.get("establishmentId") ?? "").trim();
  if (!ESTABLISHMENT_ID_PATTERN.test(establishmentId)) redirect("/dashboard/leads?error=lead-invalido");

  const { data: row } = await db.from("saved_establishments").select("establishment_id, establishments(*)").eq("profile_id", user.id).eq("establishment_id", establishmentId).maybeSingle();
  const establishment = extractSingleObject(row?.establishments);
  if (!establishment) redirect("/dashboard/leads?error=lead-invalido");
  const display = buildDisplayEstablishment(establishment);
  const collectedAt = new Date().toISOString();
  const facts = deriveEnrichmentFacts({ website: String(display.website ?? ""), email: String(display.email ?? ""), phone: String(display.phone ?? "") }, collectedAt);

  const { error } = await db.from("prospecting_enrichments").upsert(
    facts.map((fact) => ({ profile_id: user.id, establishment_id: establishmentId, field_key: fact.fieldKey, value: fact.value, source: fact.source, collected_at: fact.collectedAt, confidence: fact.confidence, is_personal: fact.isPersonal, updated_at: collectedAt })),
    { onConflict: "profile_id,establishment_id,field_key" }
  );
  if (error) {
    console.error("Falha no enriquecimento da prospecção", error);
    redirect("/dashboard/leads?error=enriquecimento-falhou");
  }
  revalidateLeadPaths();
  redirect("/dashboard/leads?status=enriquecimento-concluido");
}

export async function assignSavedLeadListAction(formData: FormData) {
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  const establishmentId = String(formData.get("establishmentId") ?? "").trim();
  const listId = String(formData.get("listId") ?? "").trim();
  const newListName = String(formData.get("newListName") ?? "").trim();

  if (!establishmentId) {
    redirect("/dashboard/leads?error=lead-invalido");
  }

  let resolvedListId: string | null = listId || null;

  if (newListName) {
    const { data: createdList, error: createError } = await db
      .from("saved_lead_lists")
      .upsert(
        {
          profile_id: user.id,
          name: newListName
        },
        { onConflict: "profile_id,name" }
      )
      .select("id")
      .single();

    if (createError || !createdList) {
      console.error("Falha ao criar lista para atribuição", createError);
      redirect("/dashboard/leads?error=lista-duplicada");
    }

    resolvedListId = createdList.id;
  }

  if (resolvedListId) {
    const { data: ownedList } = await db
      .from("saved_lead_lists")
      .select("id")
      .eq("id", resolvedListId)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!ownedList) redirect("/dashboard/leads?error=lista-invalida");
  }

  const { error } = await db
    .from("saved_establishments")
    .update({ list_id: resolvedListId })
    .eq("profile_id", user.id)
    .eq("establishment_id", establishmentId);

  if (error) {
    console.error("Falha ao vincular lead à lista", error);
    redirect("/dashboard/leads?error=lista-vinculo");
  }

  revalidateLeadPaths();
  redirect("/dashboard/leads?status=lead-vinculado");
}

export async function deleteSavedLeadListAction(formData: FormData) {
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  const listId = String(formData.get("listId") ?? "").trim();
  if (!listId) {
    redirect("/dashboard/leads?error=lista-invalida");
  }

  const { data: ownedList } = await db
    .from("saved_lead_lists")
    .select("id")
    .eq("id", listId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!ownedList) {
    redirect("/dashboard/leads?error=lista-invalida");
  }

  await db
    .from("saved_establishments")
    .update({ list_id: null })
    .eq("profile_id", user.id)
    .eq("list_id", listId);

  const { error } = await db
    .from("saved_lead_lists")
    .delete()
    .eq("id", listId)
    .eq("profile_id", user.id);

  if (error) {
    console.error("Falha ao excluir lista", error);
    redirect("/dashboard/leads?error=lista-exclusao");
  }

  revalidateLeadPaths();
  redirect("/dashboard/leads?status=lista-excluida");
}

export async function deleteSearchHistoryItemAction(searchId: string) {
  const normalizedSearchId = String(searchId ?? "").trim();
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  if (!normalizedSearchId) {
    redirect("/dashboard/history?error=busca-invalida");
  }

  const ownedIds = await resolveOwnedSearchIds([normalizedSearchId], user.id);
  if (ownedIds.length === 0) {
    redirect("/dashboard/history?error=busca-nao-encontrada");
  }

  const { error: deleteError } = await db.from("search_queries").delete().in("id", ownedIds);

  if (deleteError) {
    console.error("Falha ao excluir item do histórico", deleteError);
    redirect("/dashboard/history?error=falha-excluir-item");
  }

  revalidateHistoryPaths(ownedIds);
  redirect("/dashboard/history?status=item-excluido");
}

export async function deleteSelectedSearchHistoryAction(formData: FormData) {
  const selectedIds = uniqueIds(formData.getAll("searchIds"));
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  if (selectedIds.length === 0) {
    redirect("/dashboard/history?error=nada-selecionado");
  }

  const ownedIds = await resolveOwnedSearchIds(selectedIds, user.id);
  if (ownedIds.length === 0) {
    redirect("/dashboard/history?error=busca-nao-encontrada");
  }

  const { error } = await db.from("search_queries").delete().in("id", ownedIds);

  if (error) {
    console.error("Falha ao excluir buscas selecionadas", error);
    redirect("/dashboard/history?error=falha-excluir-selecionadas");
  }

  revalidateHistoryPaths(ownedIds);
  redirect("/dashboard/history?status=selecionadas-excluidas");
}

export async function deleteAllSearchHistoryAction() {
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  const { error } = await db.from("search_queries").delete().eq("profile_id", user.id);

  if (error) {
    console.error("Falha ao excluir histórico completo", error);
    redirect("/dashboard/history?error=falha-excluir-tudo");
  }

  revalidateHistoryPaths();
  redirect("/dashboard/history?status=tudo-excluido");
}
