"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/env";

function normalizeAbsoluteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    return "";
  }
}

async function getRequestOrigin() {
  const requestHeaders = await headers();
  const originHeader = normalizeAbsoluteUrl(requestHeaders.get("origin") ?? "");
  if (originHeader) return originHeader;

  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  if (host) {
    const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
    return `${protocol}://${host}`;
  }

  return getBaseUrl();
}

export async function requestMagicLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirect("/sign-in?error=Informe um email válido.");
  }

  const supabase = await createSupabaseServerClient();
  const confirmUrl = new URL("/auth/confirm", await getRequestOrigin());
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
