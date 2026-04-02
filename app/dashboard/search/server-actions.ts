"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runDiscoverySearch } from "@/lib/discovery/service";

export async function runSearchAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?message=Faça login para continuar.");
  }

  const input = {
    cnae: String(formData.get("cnae") ?? ""),
    stateCode: String(formData.get("stateCode") ?? ""),
    cityName: String(formData.get("cityName") ?? ""),
    cityIbge: String(formData.get("cityIbge") ?? "")
  };

  const result = await runDiscoverySearch({
    ...input,
    profileId: user.id
  });

  if (!result.ok) {
    redirect(`/dashboard/search?error=${encodeURIComponent(result.error)}`);
  }

  redirect(`/dashboard/search/${result.data.searchId}`);
}
