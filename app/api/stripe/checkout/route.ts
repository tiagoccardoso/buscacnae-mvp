import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getBaseUrl } from "@/lib/env";
import { createOneTimeCheckoutSession } from "@/lib/stripe";
import {
  ensureStripeCustomerForUser,
  getSearchAccessOrderById,
  markSearchAccessOrderCheckoutCreated
} from "@/lib/billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const orderId = String(formData.get("orderId") ?? "").trim();
  const emailInput = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!orderId) {
    return NextResponse.redirect(new URL("/?error=Pedido não informado.", getBaseUrl()), 303);
  }

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const order = await getSearchAccessOrderById(orderId);

  if (!order) {
    return NextResponse.redirect(new URL("/?error=Pedido não encontrado.", getBaseUrl()), 303);
  }

  if (order.status === "paid" || order.status === "free") {
    return NextResponse.redirect(new URL(`/orders/${order.access_token}`, getBaseUrl()), 303);
  }

  const resolvedEmail = String(user?.email ?? emailInput ?? order.email ?? "").trim().toLowerCase();

  if (!resolvedEmail) {
    return NextResponse.redirect(
      new URL(`/checkout/${order.id}?reason=${encodeURIComponent("Informe um e-mail válido antes de seguir para o checkout.")}`, getBaseUrl()),
      303
    );
  }

  if (order.email !== resolvedEmail || (user?.id && order.profile_id !== user.id)) {
    await admin
      .from("search_access_orders")
      .update({
        email: resolvedEmail,
        profile_id: user?.id ?? order.profile_id
      })
      .eq("id", order.id);
  }

  let stripeCustomerId: string | null = order.stripe_customer_id;

  if (!stripeCustomerId && user?.id && resolvedEmail) {
    stripeCustomerId = await ensureStripeCustomerForUser({
      userId: user.id,
      email: resolvedEmail
    });
  }

  const successUrl = new URL(`/orders/${order.access_token}`, getBaseUrl());
  successUrl.searchParams.set("checkout", "success");
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

  const cancelUrl = new URL(`/checkout/${order.id}`, getBaseUrl());
  cancelUrl.searchParams.set("checkout", "cancelled");

  const session = await createOneTimeCheckoutSession({
    customerId: stripeCustomerId,
    customerEmail: resolvedEmail || undefined,
    amountCents: order.total_amount_cents,
    currency: order.currency,
    orderId: order.id,
    orderAccessToken: order.access_token,
    successUrl: successUrl.toString(),
    cancelUrl: cancelUrl.toString(),
    productName: "Lista B2B da pesquisa",
    productDescription: `Pedido ${order.id} · valor calculado pela composição do lote`,
    metadata: {
      order_type: "search_access",
      search_query_id: order.search_query_id
    }
  });

  await markSearchAccessOrderCheckoutCreated({
    orderId: order.id,
    customerId: stripeCustomerId,
    checkoutSessionId: session.id,
    checkoutUrl: session.url
  });

  if (!session.url) {
    return NextResponse.redirect(
      new URL(`/checkout/${order.id}?reason=Não foi possível criar o Checkout.`, getBaseUrl()),
      303
    );
  }

  return NextResponse.redirect(session.url, 303);
}
