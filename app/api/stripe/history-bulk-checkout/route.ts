import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { getBaseUrl } from "@/lib/env";
import { createOneTimeCheckoutSession } from "@/lib/stripe";
import {
  createSearchAccessBulkOrder,
  ensureSearchAccessOrderForSearch,
  ensureStripeCustomerForUser,
  markSearchAccessBulkOrderCheckoutCreated
} from "@/lib/billing";

export const runtime = "nodejs";

function uniqueIds(values: FormDataEntryValue[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const selectedSearchIds = uniqueIds(formData.getAll("searchIds"));

  if (selectedSearchIds.length === 0) {
    return NextResponse.redirect(new URL("/dashboard/history?error=nada-selecionado-compra", getBaseUrl()), 303);
  }

  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    return NextResponse.redirect(new URL("/sign-in?message=Faça login para continuar.", getBaseUrl()), 303);
  }

  const { data: searches, error: searchesError } = await db
    .from("search_queries")
    .select("id, profile_id, provider, total_results")
    .in("id", selectedSearchIds)
    .eq("profile_id", user.id);

  if (searchesError || !searches || searches.length === 0) {
    return NextResponse.redirect(new URL("/dashboard/history?error=busca-nao-encontrada-compra", getBaseUrl()), 303);
  }

  const ensuredOrders = [];
  for (const search of searches) {
    const order = await ensureSearchAccessOrderForSearch({
      searchQueryId: search.id,
      profileId: user.id,
      email: user.email ?? undefined,
      provider: typeof search.provider === "string" ? search.provider : undefined,
      totalResults: typeof search.total_results === "number" ? search.total_results : undefined
    });
    ensuredOrders.push(order);
  }

  const payableOrders = ensuredOrders.filter((order) => order.status !== "paid" && order.status !== "free" && order.total_amount_cents > 0);

  if (payableOrders.length === 0) {
    return NextResponse.redirect(new URL("/dashboard/history?status=listas-ja-liberadas", getBaseUrl()), 303);
  }

  const bundle = await createSearchAccessBulkOrder({
    profileId: user.id,
    email: user.email ?? undefined,
    orders: payableOrders
  });

  let stripeCustomerId: string | null = null;
  if (user.email) {
    stripeCustomerId = await ensureStripeCustomerForUser({
      userId: user.id,
      email: user.email
    });
  }

  const successUrl = new URL(`/api/stripe/history-bulk-success`, getBaseUrl());
  successUrl.searchParams.set("bundle", bundle.id);

  const cancelUrl = new URL(`/dashboard/history`, getBaseUrl());
  cancelUrl.searchParams.set("status", "compra-multipla-cancelada");

  const session = await createOneTimeCheckoutSession({
    customerId: stripeCustomerId,
    customerEmail: bundle.email,
    amountCents: bundle.total_amount_cents,
    currency: bundle.currency,
    orderId: bundle.id,
    orderAccessToken: bundle.access_token,
    successUrl: successUrl.toString(),
    cancelUrl: cancelUrl.toString(),
    productName: "Listas B2B selecionadas",
    productDescription: `${bundle.order_count} lista(s) selecionada(s) para recompra no histórico`,
    metadata: {
      order_type: "search_access_bundle",
      bulk_order_id: bundle.id
    }
  });

  try {
    await markSearchAccessBulkOrderCheckoutCreated({
      orderId: bundle.id,
      customerId: stripeCustomerId,
      checkoutSessionId: session.id,
      checkoutUrl: session.url
    });
  } catch (error) {
    console.error("[history-bulk-checkout] Falha ao persistir a sessão Stripe do lote", {
      bundleId: bundle.id,
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.redirect(new URL("/dashboard/history?error=falha-checkout-multiplo", getBaseUrl()), 303);
  }

  if (!session.url) {
    return NextResponse.redirect(new URL("/dashboard/history?error=falha-checkout-multiplo", getBaseUrl()), 303);
  }

  return NextResponse.redirect(session.url, 303);
}
