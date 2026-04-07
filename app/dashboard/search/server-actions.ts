"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prepareSearchOrder } from "@/lib/discovery/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseNumber } from "@/lib/utils";

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
  return parseNumber(text);
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

  const capitalSocialMin = parseCapitalInput(formData.get("capitalSocialMin"));
  const capitalSocialMax = parseCapitalInput(formData.get("capitalSocialMax"));
  const normalizedCapitalRange =
    capitalSocialMin !== null && capitalSocialMax !== null && capitalSocialMin > capitalSocialMax
      ? { min: capitalSocialMax, max: capitalSocialMin }
      : { min: capitalSocialMin, max: capitalSocialMax };

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
    capitalSocialMin: normalizedCapitalRange.min,
    capitalSocialMax: normalizedCapitalRange.max,
    activityStartYear: parseYearInput(formData.get("activityStartYear"))
  });

  if (!result.ok) {
    redirect(`/dashboard/search?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/history");
  redirect(`/dashboard/search/${result.data.searchId}`);
}
