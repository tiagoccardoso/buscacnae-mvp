import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/env";
import { getStripeClient } from "@/lib/stripe";
import {
  getSearchAccessBulkOrderById,
  markSearchAccessBulkOrderPaid,
  markSearchAccessOrdersPaidByIds
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
  const sessionId = url.searchParams.get("session_id") ?? "";

  if (!bundleId || !sessionId) {
    return NextResponse.redirect(new URL("/dashboard/history?error=retorno-checkout-invalido", getBaseUrl()), 303);
  }

  const bundle = await getSearchAccessBulkOrderById(bundleId);
  if (!bundle) {
    return NextResponse.redirect(new URL("/dashboard/history?error=checkout-multiplo-nao-encontrado", getBaseUrl()), 303);
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== "paid") {
    return NextResponse.redirect(new URL("/dashboard/history?status=compra-multipla-cancelada", getBaseUrl()), 303);
  }

  const orderIds = normalizeOrderIdsPayload(bundle.order_ids);

  await markSearchAccessBulkOrderPaid({
    orderId: bundle.id,
    sessionId,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
  });

  await markSearchAccessOrdersPaidByIds({
    orderIds,
    sessionId,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
  });

  return NextResponse.redirect(new URL("/dashboard/history?status=compra-multipla-sucesso", getBaseUrl()), 303);
}
