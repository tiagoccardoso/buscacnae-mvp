import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/env";
import { createOneTimeCheckoutSession } from "@/lib/stripe";
import { getAiFormattingPriceSummary } from "@/lib/ai-format-pricing";
import {
  ensureSearchAccessOrderForSearch,
  ensureSearchAiFormatOrderForSearch,
  ensureStripeCustomerForUser,
  markSearchAiFormatOrderCheckoutCreated,
  syncSearchAccessOrderPaymentStatus,
  syncSearchAiFormatOrderPaymentStatus
} from "@/lib/billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const searchId = String(formData.get("searchId") ?? "").trim();

  if (!searchId) {
    return NextResponse.redirect(new URL("/dashboard/search?error=Busca não informada.", getBaseUrl()), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/sign-in?message=Faça login para continuar.", getBaseUrl()), 303);
  }

  const { data: search } = await supabase
    .from("search_queries")
    .select("id, profile_id, provider, total_results")
    .eq("id", searchId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!search) {
    return NextResponse.redirect(new URL("/dashboard/search?error=Busca não encontrada.", getBaseUrl()), 303);
  }

  const accessOrder = await ensureSearchAccessOrderForSearch({
    searchQueryId: searchId,
    profileId: user.id,
    email: user.email ?? undefined,
    provider: typeof search.provider === "string" ? search.provider : undefined,
    totalResults: typeof search.total_results === "number" ? search.total_results : undefined
  });

  const syncedAccessOrder = await syncSearchAccessOrderPaymentStatus(accessOrder);
  const listUnlocked = syncedAccessOrder.status === "paid" || syncedAccessOrder.status === "free";

  if (!listUnlocked) {
    return NextResponse.redirect(
      new URL(`/dashboard/search/${searchId}?ai_format=blocked`, getBaseUrl()),
      303
    );
  }

  const aiOrder = await ensureSearchAiFormatOrderForSearch({
    searchQueryId: searchId,
    profileId: user.id,
    email: user.email ?? undefined
  });
  const syncedAiOrder = await syncSearchAiFormatOrderPaymentStatus(aiOrder);

  if (syncedAiOrder.status === "paid") {
    return NextResponse.redirect(new URL(`/dashboard/search/${searchId}?ai_format=success`, getBaseUrl()), 303);
  }

  let stripeCustomerId: string | null = syncedAiOrder.stripe_customer_id;

  if (!stripeCustomerId && user.email) {
    stripeCustomerId = await ensureStripeCustomerForUser({
      userId: user.id,
      email: user.email
    });
  }

  const successUrl = new URL(`/dashboard/search/${searchId}`, getBaseUrl());
  successUrl.searchParams.set("ai_format", "success");
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

  const cancelUrl = new URL(`/dashboard/search/${searchId}`, getBaseUrl());
  cancelUrl.searchParams.set("ai_format", "cancelled");

  const session = await createOneTimeCheckoutSession({
    customerId: stripeCustomerId,
    customerEmail: syncedAiOrder.email,
    amountCents: syncedAiOrder.amount_cents,
    currency: syncedAiOrder.currency,
    orderId: syncedAiOrder.id,
    orderAccessToken: syncedAiOrder.access_token,
    successUrl: successUrl.toString(),
    cancelUrl: cancelUrl.toString(),
    productName: "Lista pronta para prospecção com IA",
    productDescription: `Upgrade com IA para ${getAiFormattingPriceSummary(Number(search.total_results ?? 0)).totalLeads} leads: XLSX organizado, aba Contatos WhatsApp e PDF legível`,
    metadata: {
      order_type: "search_ai_format",
      search_query_id: searchId
    }
  });

  await markSearchAiFormatOrderCheckoutCreated({
    orderId: syncedAiOrder.id,
    customerId: stripeCustomerId,
    checkoutSessionId: session.id,
    checkoutUrl: session.url
  });

  if (!session.url) {
    return NextResponse.redirect(
      new URL(`/dashboard/search/${searchId}?ai_format=error`, getBaseUrl()),
      303
    );
  }

  return NextResponse.redirect(session.url, 303);
}
