import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  const orderId = String(formData.get("orderId") ?? "");

  if (!orderId) {
    return NextResponse.redirect(new URL("/?error=Pedido não informado.", getBaseUrl()), 303);
  }

  const supabase = await createSupabaseServerClient();
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

  let stripeCustomerId: string | null = order.stripe_customer_id;

  if (!stripeCustomerId && user?.id && user.email) {
    stripeCustomerId = await ensureStripeCustomerForUser({
      userId: user.id,
      email: user.email
    });
  }

  const successUrl = new URL(`/orders/${order.access_token}`, getBaseUrl());
  successUrl.searchParams.set("checkout", "success");
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

  const cancelUrl = new URL(`/checkout/${order.id}`, getBaseUrl());
  cancelUrl.searchParams.set("checkout", "cancelled");

  const session = await createOneTimeCheckoutSession({
    customerId: stripeCustomerId,
    customerEmail: order.email,
    amountCents: order.total_amount_cents,
    currency: order.currency,
    orderId: order.id,
    orderAccessToken: order.access_token,
    successUrl: successUrl.toString(),
    cancelUrl: cancelUrl.toString()
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
