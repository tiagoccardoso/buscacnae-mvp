"use server";

import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db-client";
import { getCurrentUser } from "@/lib/auth/server";
import { getSearchAccessOrderById } from "@/lib/billing";

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

  const db = createDbClient();
  const user = await getCurrentUser();

  await db
    .from("search_access_orders")
    .update({
      email,
      profile_id: order.profile_id ?? user?.id ?? null
    })
    .eq("id", order.id);

  if (user?.id) {
    await db.from("profiles").upsert({ id: user.id, email }, { onConflict: "id" });
    redirect(`/dashboard/history?status=busca-vinculada`);
  }

  redirect(
    `/sign-in?email=${encodeURIComponent(email)}&order_id=${encodeURIComponent(order.id)}&next=${encodeURIComponent(
      "/dashboard/history?status=busca-vinculada"
    )}&message=${encodeURIComponent("Entre com sua conta para vincular esta busca ao seu dashboard.")}`
  );
}
