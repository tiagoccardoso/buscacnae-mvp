import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/env";
import { getStripeClient } from "@/lib/stripe";
import {
  finalizeSearchAccessBulkOrderPayment,
  getSearchAccessBulkOrderById,
  getSearchAccessBulkOrderByCheckoutSessionId
} from "@/lib/billing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionIdFromQuery = (url.searchParams.get("session_id") ?? "").trim();

    if (!sessionIdFromQuery || sessionIdFromQuery.includes("CHECKOUT_SESSION_ID")) {
      return NextResponse.redirect(new URL("/dashboard/history?error=retorno-checkout-invalido", getBaseUrl()), 303);
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionIdFromQuery);

    if (session.payment_status !== "paid") {
      if (session.status === "expired") {
        return NextResponse.redirect(new URL("/dashboard/history?status=compra-multipla-cancelada", getBaseUrl()), 303);
      }

      return NextResponse.redirect(new URL("/dashboard/history?status=compra-multipla-processando", getBaseUrl()), 303);
    }

    if (session.mode !== "payment") {
      return NextResponse.redirect(new URL("/dashboard/history?error=retorno-checkout-invalido", getBaseUrl()), 303);
    }

    const metadataOrderType = typeof session.metadata?.order_type === "string" ? session.metadata.order_type : null;
    if (metadataOrderType && metadataOrderType !== "search_access_bundle") {
      return NextResponse.redirect(new URL("/dashboard/history?error=retorno-checkout-invalido", getBaseUrl()), 303);
    }

    const metadataBulkOrderId = typeof session.metadata?.bulk_order_id === "string" ? session.metadata.bulk_order_id : null;
    const resolvedBundle = metadataBulkOrderId
      ? await getSearchAccessBulkOrderById(metadataBulkOrderId)
      : await getSearchAccessBulkOrderByCheckoutSessionId(session.id);
    if (!resolvedBundle) {
      return NextResponse.redirect(new URL("/dashboard/history?error=checkout-multiplo-nao-encontrado", getBaseUrl()), 303);
    }

    await finalizeSearchAccessBulkOrderPayment({
      bulkOrderId: resolvedBundle.id,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });

    return NextResponse.redirect(new URL("/dashboard/history?status=compra-multipla-sucesso", getBaseUrl()), 303);
  } catch (error) {
    console.error("[history-bulk-success] failed to confirm checkout session", error);
    return NextResponse.redirect(new URL("/dashboard/history?error=retorno-checkout-invalido", getBaseUrl()), 303);
  }
}
