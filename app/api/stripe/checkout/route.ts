import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBaseUrl, getMinimumCheckoutAmountCents } from "@/lib/env";
import { createOneTimeCheckoutSession } from "@/lib/stripe";
import {
  ensureStripeCustomerForUser,
  getSearchAccessOrderById,
  markSearchAccessOrderCheckoutCreated
} from "@/lib/billing";

export const runtime = "nodejs";

function formatCheckoutError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; code?: unknown; type?: unknown };
    const parts = [candidate.message, candidate.code, candidate.type]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  return "Não foi possível iniciar o checkout agora.";
}

function redirectToCheckout(orderId: string, reason: string) {
  const url = new URL(`/checkout/${orderId}`, getBaseUrl());
  if (reason.trim()) {
    url.searchParams.set("reason", reason);
  }
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const orderId = String(formData.get("orderId") ?? "").trim();

  if (!orderId) {
    return NextResponse.redirect(new URL("/?error=Pedido não informado.", getBaseUrl()), 303);
  }

  try {
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

    const minimumCheckoutAmountCents = getMinimumCheckoutAmountCents();
    if (order.total_amount_cents < minimumCheckoutAmountCents) {
      return redirectToCheckout(
        order.id,
        `O valor mínimo para checkout é de R$ ${(minimumCheckoutAmountCents / 100).toFixed(2).replace(".", ",")}. Ajuste MINIMUM_CHECKOUT_AMOUNT_CENTS ou aumente a quantidade de resultados.`
      );
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
      return redirectToCheckout(order.id, "Não foi possível criar o link do checkout.");
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    return redirectToCheckout(orderId, formatCheckoutError(error));
  }
}
