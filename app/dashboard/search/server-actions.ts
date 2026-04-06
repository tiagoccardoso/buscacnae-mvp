"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prepareSearchOrder } from "@/lib/discovery/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildCitySelectionFromFormData(formData: FormData) {
  const explicitSelection = String(formData.get("citySelection") ?? "").trim();
  if (explicitSelection) {
    return explicitSelection;
  }

  const cityName = String(formData.get("cityName") ?? "").trim();
  const stateCode = String(formData.get("stateCode") ?? "").trim().toUpperCase();

  if (!cityName || !stateCode) {
    return "";
  }

  return JSON.stringify([{ cityName, stateCode }]);
}

function parseCapitalInput(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseYearInput(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  const currentYear = new Date().getFullYear();
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= currentYear ? parsed : null;
}

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
    citySelection: buildCitySelectionFromFormData(formData),
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
    capitalSocialMin: parseCapitalInput(formData.get("capitalSocialMin")),
    capitalSocialMax: parseCapitalInput(formData.get("capitalSocialMax")),
    activityStartYear: parseYearInput(formData.get("activityStartYear"))
  });

  if (!result.ok) {
    redirect(`/dashboard/search?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/history");
  redirect(`/dashboard/search/${result.data.searchId}`);
}
