"use server";

import { redirect } from "next/navigation";
import { prepareSearchOrder } from "@/lib/discovery/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function startPublicSearchAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const emailInput = String(formData.get("email") ?? "").trim().toLowerCase();
  const email = (user?.email ?? emailInput).trim().toLowerCase();

  const result = await prepareSearchOrder({
    profileId: user?.id ?? null,
    email,
    cnae: String(formData.get("cnae") ?? ""),
    stateCode: String(formData.get("stateCode") ?? ""),
    citySelection: String(formData.get("citySelection") ?? ""),
    stateWide: formData.get("stateWide") === "on",
    requireEmail: formData.get("requireEmail") === "on",
    requireAddress: formData.get("requireAddress") === "on",
    requirePhone: formData.get("requirePhone") === "on",
    mobileOnly: formData.get("mobileOnly") === "on"
  });

  if (!result.ok) {
    redirect(`/?error=${encodeURIComponent(result.error)}`);
  }

  redirect(`/checkout/${result.data.orderId}`);
}
