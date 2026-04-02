"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
