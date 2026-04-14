import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/env";
import { getStripeClient } from "@/lib/stripe";
import {
  finalizeSearchAccessBulkOrderPayment,
  getSearchAccessBulkOrderById,
  getSearchAccessOrdersByIds
} from "@/lib/billing";

export const runtime = "nodejs";

function normalizeOrderIdsPayload(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    )
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bundleId = url.searchParams.get("bundle") ?? "";
  const sessionIdFromQuery = url.searchParams.get("session_id") ?? "";

  if (!bundleId) {
    return NextResponse.redirect(new URL("/dashboard/history?error=retorno-checkout-invalido", getBaseUrl()), 303);
  }

  const bundle = await getSearchAccessBulkOrderById(bundleId);
  if (!bundle) {
    return NextResponse.redirect(new URL("/dashboard/history?error=checkout-multiplo-nao-encontrado", getBaseUrl()), 303);
  }

  const bundleSessionId = typeof bundle.stripe_checkout_session_id === "string" ? bundle.stripe_checkout_session_id.trim() : "";
  const resolvedSessionId = bundleSessionId || sessionIdFromQuery.trim();

  if (!resolvedSessionId) {
    const orderIds = normalizeOrderIdsPayload(bundle.order_ids);
    const orders = await getSearchAccessOrdersByIds(orderIds);
    const allUnlocked = orderIds.length > 0 && orders.length === orderIds.length && orders.every((order) => order.status === "paid" || order.status === "free");

    if ((bundle.status === "paid" || bundle.status === "free") && allUnlocked) {
      return NextResponse.redirect(new URL("/dashboard/history?status=compra-multipla-sucesso", getBaseUrl()), 303);
    }

    console.error("[history-bulk-success] Retorno do checkout em grupo sem session_id resolvido", {
      bundleId: bundle.id,
      bundleStatus: bundle.status
    });

    return NextResponse.redirect(new URL("/dashboard/history?error=retorno-checkout-invalido", getBaseUrl()), 303);
  }

  const stripe = getStripeClient();

  try {
    const session = await stripe.checkout.sessions.retrieve(resolvedSessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.redirect(new URL("/dashboard/history?status=compra-multipla-cancelada", getBaseUrl()), 303);
    }

    await finalizeSearchAccessBulkOrderPayment({
      bulkOrder: bundle,
      sessionId: resolvedSessionId,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });
  } catch (error) {
    console.error("[history-bulk-success] Falha ao finalizar o checkout em grupo", {
      bundleId: bundle.id,
      sessionId: resolvedSessionId,
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.redirect(new URL("/dashboard/history?error=retorno-checkout-invalido", getBaseUrl()), 303);
  }

  return NextResponse.redirect(new URL("/dashboard/history?status=compra-multipla-sucesso", getBaseUrl()), 303);
}
