"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function toggleSavedEstablishmentAction(formData: FormData) {
  const establishmentId = String(formData.get("establishmentId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (!establishmentId || !["save", "remove"].includes(intent)) {
    return;
  }

  if (intent === "save") {
    await supabase.from("saved_establishments").upsert(
      {
        profile_id: user.id,
        establishment_id: establishmentId
      },
      {
        onConflict: "profile_id,establishment_id"
      }
    );
  } else {
    await supabase
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
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

export async function deleteSearchHistoryItemAction(formData: FormData) {
  const searchId = String(formData.get("searchId") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (!searchId) {
    redirect("/dashboard/history?error=busca-invalida");
  }

  const ownedIds = await resolveOwnedSearchIds([searchId], user.id);
  if (ownedIds.length === 0) {
    redirect("/dashboard/history?error=busca-nao-encontrada");
  }

  const admin = createSupabaseAdminClient();
  const { error: deleteError } = await admin.from("search_queries").delete().in("id", ownedIds);

  if (deleteError) {
    console.error("Falha ao excluir item do histórico", deleteError);
    redirect("/dashboard/history?error=falha-excluir-item");
  }

  revalidateHistoryPaths(ownedIds);
  redirect("/dashboard/history?status=item-excluido");
}

export async function deleteSelectedSearchHistoryAction(formData: FormData) {
  const selectedIds = uniqueIds(formData.getAll("searchIds"));
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

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

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("search_queries").delete().in("id", ownedIds);

  if (error) {
    console.error("Falha ao excluir buscas selecionadas", error);
    redirect("/dashboard/history?error=falha-excluir-selecionadas");
  }

  revalidateHistoryPaths(ownedIds);
  redirect("/dashboard/history?status=selecionadas-excluidas");
}

export async function deleteAllSearchHistoryAction() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("search_queries").delete().eq("profile_id", user.id);

  if (error) {
    console.error("Falha ao excluir histórico completo", error);
    redirect("/dashboard/history?error=falha-excluir-tudo");
  }

  revalidateHistoryPaths();
  redirect("/dashboard/history?status=tudo-excluido");
}
