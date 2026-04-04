"use server";

import { redirect } from "next/navigation";
import { prepareSearchOrder } from "@/lib/discovery/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function runSearchAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?message=Faça login para continuar.");
  }

  const email = String(user.email ?? "").trim().toLowerCase();

  const result = await prepareSearchOrder({
    profileId: user.id,
    email,
    cnae: String(formData.get("cnae") ?? ""),
    stateCode: String(formData.get("stateCode") ?? ""),
    citySelection: String(formData.get("citySelection") ?? ""),
    stateWide: formData.get("stateWide") === "on",
    requireEmail: formData.get("requireEmail") === "on",
    requireAddress: formData.get("requireAddress") === "on",
    requirePhone: formData.get("requirePhone") === "on",
    mobileOnly: formData.get("mobileOnly") === "on",
    companySizes: String(formData.get("companySizes") ?? "")
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean),
    simplesOnly: formData.get("simplesOnly") === "on",
    capitalSocialMin: (() => {
      const value = String(formData.get("capitalSocialMin") ?? "").trim();
      if (!value) return null;
      const parsed = Number(value.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    })(),
    capitalSocialMax: (() => {
      const value = String(formData.get("capitalSocialMax") ?? "").trim();
      if (!value) return null;
      const parsed = Number(value.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    })()
  });

  if (!result.ok) {
    redirect(`/dashboard/search?error=${encodeURIComponent(result.error)}`);
  }

  redirect(`/dashboard/search/${result.data.searchId}`);
}
