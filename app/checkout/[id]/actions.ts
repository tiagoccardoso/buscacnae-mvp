"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSearchAccessOrderById } from "@/lib/billing";
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

export async function prepareCheckoutIdentityAction(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!orderId) {
    redirect(`/sign-in?error=${encodeURIComponent("Pedido não informado.")}`);
  }

  if (!email) {
    redirect(`/checkout/${orderId}?reason=${encodeURIComponent("Informe um e-mail válido para continuar para o checkout.")}`);
  }

  const order = await getSearchAccessOrderById(orderId);
  if (!order) {
    redirect(`/sign-in?error=${encodeURIComponent("Pedido não encontrado.")}`);
  }

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  await admin
    .from("search_access_orders")
    .update({
      email,
      profile_id: order.profile_id ?? user?.id ?? null
    })
    .eq("id", order.id);

  if (user?.id) {
    await admin.from("profiles").upsert({ id: user.id, email }, { onConflict: "id" });
  }

  const confirmUrl = new URL("/auth/confirm", await getRequestOrigin());
  confirmUrl.searchParams.set("next", "/dashboard/history?status=busca-vinculada");
  confirmUrl.searchParams.set("order_id", order.id);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: confirmUrl.toString()
    }
  });

  if (error) {
    redirect(`/checkout/${order.id}?reason=${encodeURIComponent(error.message)}`);
  }

  redirect(`/checkout/${order.id}?identity=sent`);
}
