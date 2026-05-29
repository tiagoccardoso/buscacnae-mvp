"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db-client";
import { getCurrentUser } from "@/lib/auth/server";

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
