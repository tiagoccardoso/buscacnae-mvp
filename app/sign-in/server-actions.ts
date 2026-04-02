"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/env";

export async function requestMagicLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirect("/sign-in?error=Informe um email válido.");
  }

  const supabase = await createSupabaseServerClient();
  const confirmUrl = new URL("/auth/confirm", getBaseUrl());
  confirmUrl.searchParams.set("next", "/dashboard");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: confirmUrl.toString()
    }
  });

  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/sign-in?message=Enviamos o link de acesso para o seu email.");
}
