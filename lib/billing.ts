import crypto from "node:crypto";
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe";
import { getAiFormattingPriceCents, getMinimumCheckoutAmountCents } from "@/lib/env";
import { readLeadPricingSummary, type LeadPricingSummary } from "@/lib/lead-pricing";

export type SearchAccessOrderRecord = {
  id: string;
  access_token: string;
  profile_id: string | null;
  email: string;
  provider: string;
  search_query_id: string;
  result_count: number;
  unit_amount_cents: number;
  total_amount_cents: number;
  currency: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  checkout_url: string | null;
  paid_at: string | null;
  unlocked_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SearchAiFormatOrderRecord = {
  id: string;
  access_token: string;
  profile_id: string | null;
  email: string;
  search_query_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  checkout_url: string | null;
  formatted_payload: unknown;
  format_error: string | null;
  formatted_at: string | null;
  paid_at: string | null;
  unlocked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SearchAccessBulkOrderRecord = {
  id: string;
  access_token: string;
  profile_id: string | null;
  email: string;
  order_ids: unknown;
  order_count: number;
  total_amount_cents: number;
  currency: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  checkout_url: string | null;
  paid_at: string | null;
  unlocked_at: string | null;
  created_at: string;
  updated_at: string;
};

function isSearchAccessOrderUnlocked(status: string) {
  return status === "paid" || status === "free";
}

function isSearchAiFormatOrderUnlocked(status: string) {
  return status === "paid";
}

function isSearchAccessBulkOrderUnlocked(status: string) {
  return status === "paid" || status === "free";
}

function normalizeOrderIdsPayload(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [] as string[];
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return normalizeOrderIdsPayload(parsed);
    } catch {
      return Array.from(
        new Set(
          trimmed
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        )
      );
    }
  }

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

async function registerWebhookEvent(eventId: string, type: string, payload: unknown) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("stripe_webhook_events").insert({
    event_id: eventId,
    type,
    payload
  });

  if (error && (error as { code?: string }).code !== "23505") {
    throw error;
  }

  return !error;
}

export async function ensureStripeCustomerForUser({
  userId,
  email
}: {
  userId: string;
  email: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();

  if (profile?.stripe_customer_id) {
    return String(profile.stripe_customer_id);
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    metadata: {
      user_id: userId
    }
  });

  await admin
    .from("profiles")
    .update({
      email,
      stripe_customer_id: customer.id
    })
    .eq("id", userId);

  return customer.id;
}

export async function syncStripeCustomer(customerId: string, customer?: Stripe.Customer) {
  const stripe = getStripeClient();
  const admin = createSupabaseAdminClient();
  const resolved = customer ?? ((await stripe.customers.retrieve(customerId)) as Stripe.Customer | Stripe.DeletedCustomer);

  if ("deleted" in resolved && resolved.deleted) {
    return;
  }

  const userId = typeof resolved.metadata?.user_id === "string" ? resolved.metadata.user_id : null;

  if (!userId) {
    return;
  }

  await admin
    .from("profiles")
    .update({
      email: resolved.email ?? undefined,
      stripe_customer_id: resolved.id
    })
    .eq("id", userId);
}

export async function getSearchAccessOrderById(orderId: string): Promise<SearchAccessOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("search_access_orders").select("*").eq("id", orderId).maybeSingle();
  return (data as SearchAccessOrderRecord | null) ?? null;
}

export async function getSearchAccessOrderByAccessToken(accessToken: string): Promise<SearchAccessOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("search_access_orders")
    .select("*")
    .eq("access_token", accessToken)
    .maybeSingle();
  return (data as SearchAccessOrderRecord | null) ?? null;
}

export async function getSearchAccessOrderByCheckoutSessionId(sessionId: string): Promise<SearchAccessOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("search_access_orders")
    .select("*")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  return (data as SearchAccessOrderRecord | null) ?? null;
}

export async function claimSearchAccessOrderForUser(args: {
  orderId: string;
  userId: string;
  email: string;
}) {
  const admin = createSupabaseAdminClient();
  const normalizedEmail = args.email.trim().toLowerCase();
  const order = await getSearchAccessOrderById(args.orderId);

  if (!order) {
    return { claimed: false, reason: "order_not_found" as const };
  }

  const orderEmail = order.email.trim().toLowerCase();
  if (!normalizedEmail || orderEmail !== normalizedEmail) {
    return { claimed: false, reason: "email_mismatch" as const };
  }

  const { data: search } = await admin
    .from("search_queries")
    .select("id, profile_id")
    .eq("id", order.search_query_id)
    .maybeSingle();

  if (order.profile_id && order.profile_id !== args.userId) {
    return { claimed: false, reason: "order_already_claimed" as const };
  }

  if (search?.profile_id && search.profile_id !== args.userId) {
    return { claimed: false, reason: "search_already_claimed" as const };
  }

  await admin.from("profiles").upsert(
    {
      id: args.userId,
      email: normalizedEmail
    },
    { onConflict: "id" }
  );

  await admin
    .from("search_access_orders")
    .update({
      profile_id: args.userId,
      email: normalizedEmail
    })
    .eq("id", order.id);

  await admin
    .from("search_queries")
    .update({
      profile_id: args.userId
    })
    .eq("id", order.search_query_id);

  await admin
    .from("search_results")
    .update({
      profile_id: args.userId
    })
    .eq("search_query_id", order.search_query_id);

  return { claimed: true as const, searchQueryId: order.search_query_id, orderId: order.id };
}

export async function claimSearchAccessOrdersForUserByEmail(args: {
  userId: string;
  email: string;
  limit?: number;
}) {
  const admin = createSupabaseAdminClient();
  const normalizedEmail = args.email.trim().toLowerCase();

  if (!normalizedEmail || !args.userId) {
    return { claimedCount: 0 };
  }

  const { data: unclaimedOrders } = await admin
    .from("search_access_orders")
    .select("id")
    .is("profile_id", null)
    .eq("email", normalizedEmail)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 200);

  if (!unclaimedOrders || unclaimedOrders.length === 0) {
    return { claimedCount: 0 };
  }

  let claimedCount = 0;

  for (const order of unclaimedOrders) {
    const result = await claimSearchAccessOrderForUser({
      orderId: order.id,
      userId: args.userId,
      email: normalizedEmail
    });

    if (result.claimed) {
      claimedCount += 1;
    }
  }

  return { claimedCount };
}

function getSearchAccessOrderPricing(resultCount: number, pricingSummary?: LeadPricingSummary | null) {
  const minimumCheckoutAmountCents = getMinimumCheckoutAmountCents();
  const computedSummary = pricingSummary ?? null;
  const unitAmountCents = resultCount > 0 ? (computedSummary?.averageUnitAmountCents ?? 5) : 0;
  const baseTotalAmountCents = resultCount > 0 ? (computedSummary?.totalAmountCents ?? resultCount * 5) : 0;
  const totalAmountCents = resultCount > 0 ? Math.max(baseTotalAmountCents, minimumCheckoutAmountCents, 0) : 0;
  const status = resultCount === 0 ? "free" : "pending";

  return {
    resultCount,
    unitAmountCents,
    totalAmountCents,
    status
  };
}

function resolveFiniteInteger(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
  }

  return null;
}

export async function getLatestSearchAccessOrderBySearchQueryId(
  searchQueryId: string
): Promise<SearchAccessOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("search_access_orders")
    .select("*")
    .eq("search_query_id", searchQueryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as SearchAccessOrderRecord | null) ?? null;
}

export async function ensureSearchAccessOrderForSearch(args: {
  searchQueryId: string;
  profileId?: string | null;
  email?: string | null;
  provider?: string | null;
  totalResults?: number | null;
  pricingSummary?: LeadPricingSummary | null;
}): Promise<SearchAccessOrderRecord> {
  const admin = createSupabaseAdminClient();
  const normalizedEmail = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
  let resolvedProfileId = args.profileId ?? null;
  let resolvedProvider = args.provider ?? null;
  let resolvedTotalResults = resolveFiniteInteger(args.totalResults);
  let resolvedPricingSummary = args.pricingSummary ?? null;

  const existing = await getLatestSearchAccessOrderBySearchQueryId(args.searchQueryId);

  if (!resolvedProfileId || !resolvedProvider || resolvedTotalResults === null || !resolvedPricingSummary) {
    const { data: search, error: searchError } = await admin
      .from("search_queries")
      .select("id, profile_id, provider, total_results, query_payload")
      .eq("id", args.searchQueryId)
      .maybeSingle();

    if (searchError || !search) {
      throw searchError ?? new Error("Não foi possível localizar a busca da lista comercial.");
    }

    resolvedProfileId = resolvedProfileId ?? search.profile_id ?? null;
    resolvedProvider = resolvedProvider ?? (typeof search.provider === "string" ? search.provider : null);
    resolvedTotalResults = resolveFiniteInteger(resolvedTotalResults, search.total_results);
    if (!resolvedPricingSummary) {
      const payload = search.query_payload && typeof search.query_payload === "object" && !Array.isArray(search.query_payload)
        ? (search.query_payload as Record<string, unknown>)
        : null;
      resolvedPricingSummary = readLeadPricingSummary(payload?.leadPricingSummary);
    }
  }

  if (resolvedTotalResults === null) {
    const { count, error: countError } = await admin
      .from("search_results")
      .select("id", { count: "exact", head: true })
      .eq("search_query_id", args.searchQueryId);

    if (countError) {
      throw countError;
    }

    resolvedTotalResults = resolveFiniteInteger(count ?? 0) ?? 0;
  }

  let resolvedEmail = normalizedEmail;

  if (!resolvedEmail && resolvedProfileId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("id", resolvedProfileId)
      .maybeSingle();

    resolvedEmail = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
  }


  const pricing = getSearchAccessOrderPricing(resolvedTotalResults, resolvedPricingSummary);

  if (existing) {
    const updates: Partial<SearchAccessOrderRecord> = {};

    if (resolvedProfileId && existing.profile_id !== resolvedProfileId) {
      updates.profile_id = resolvedProfileId;
    }

    if (existing.email !== resolvedEmail) {
      updates.email = resolvedEmail;
    }

    if (resolvedProvider && existing.provider !== resolvedProvider) {
      updates.provider = resolvedProvider;
    }

    const canSyncPricing = existing.status !== "paid";
    if (canSyncPricing) {
      if (existing.result_count !== pricing.resultCount) {
        updates.result_count = pricing.resultCount;
      }
      if (existing.unit_amount_cents !== pricing.unitAmountCents) {
        updates.unit_amount_cents = pricing.unitAmountCents;
      }
      if (existing.total_amount_cents !== pricing.totalAmountCents) {
        updates.total_amount_cents = pricing.totalAmountCents;
      }
      if (existing.currency !== "brl") {
        updates.currency = "brl";
      }

      if (pricing.status === "free" && existing.status !== "free") {
        const now = new Date().toISOString();
        updates.status = "free";
        updates.paid_at = existing.paid_at ?? now;
        updates.unlocked_at = existing.unlocked_at ?? now;
      }
    }

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const { data: updatedOrder, error: updateError } = await admin
      .from("search_access_orders")
      .update(updates)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError || !updatedOrder) {
      throw updateError ?? new Error("Não foi possível atualizar o pedido comercial da busca.");
    }

    return updatedOrder as SearchAccessOrderRecord;
  }

  const now = new Date().toISOString();
  const accessToken = crypto.randomBytes(24).toString("hex");
  const { data: insertedOrder, error: insertError } = await admin
    .from("search_access_orders")
    .insert({
      access_token: accessToken,
      profile_id: resolvedProfileId,
      email: resolvedEmail,
      provider: resolvedProvider ?? "unknown",
      search_query_id: args.searchQueryId,
      result_count: pricing.resultCount,
      unit_amount_cents: pricing.unitAmountCents,
      total_amount_cents: pricing.totalAmountCents,
      currency: "brl",
      status: pricing.status,
      paid_at: pricing.status === "free" ? now : null,
      unlocked_at: pricing.status === "free" ? now : null
    })
    .select("*")
    .single();

  if (insertError || !insertedOrder) {
    if ((insertError as { code?: string } | null)?.code === "23505") {
      const concurrentOrder = await getLatestSearchAccessOrderBySearchQueryId(args.searchQueryId);
      if (concurrentOrder) {
        return concurrentOrder;
      }
    }

    throw insertError ?? new Error("Não foi possível criar o pedido comercial da busca.");
  }

  return insertedOrder as SearchAccessOrderRecord;
}

export async function syncSearchAccessOrderPaymentStatus(order: SearchAccessOrderRecord) {
  if (isSearchAccessOrderUnlocked(order.status)) {
    return order;
  }

  if (!order.stripe_checkout_session_id) {
    const bulkOrder = await findPaidBulkOrderContainingOrder(order);
    if (bulkOrder) {
      await markSearchAccessOrderPaid({
        orderId: order.id,
        sessionId: bulkOrder.stripe_checkout_session_id,
        paymentIntentId: bulkOrder.stripe_payment_intent_id
      });

      return (await getSearchAccessOrderById(order.id)) ?? order;
    }

    return order;
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);

  if (session.payment_status === "paid") {
    await markSearchAccessOrderPaid({
      orderId: order.id,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });

    return (await getSearchAccessOrderById(order.id)) ?? order;
  }

  if (session.status === "expired") {
    await markSearchAccessOrderPaymentFailed({
      orderId: order.id,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });

    return (await getSearchAccessOrderById(order.id)) ?? order;
  }

  return order;
}

async function findPaidBulkOrderContainingOrder(order: SearchAccessOrderRecord) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("search_access_bulk_orders")
    .select("*")
    .eq("status", "paid")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (order.profile_id) {
    query = query.eq("profile_id", order.profile_id);
  } else {
    query = query.eq("email", order.email);
  }

  const { data } = await query;
  const candidates = (data as SearchAccessBulkOrderRecord[] | null) ?? [];

  return candidates.find((candidate) => normalizeOrderIdsPayload(candidate.order_ids).includes(order.id)) ?? null;
}

export async function markSearchAccessOrderCheckoutCreated(args: {
  orderId: string;
  customerId?: string | null;
  checkoutSessionId: string;
  checkoutUrl?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("search_access_orders")
    .update({
      stripe_customer_id: args.customerId ?? null,
      stripe_checkout_session_id: args.checkoutSessionId,
      checkout_url: args.checkoutUrl ?? null,
      status: "pending"
    })
    .eq("id", args.orderId);
}

export async function markSearchAccessOrderPaid(args: {
  orderId?: string | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  let query = admin
    .from("search_access_orders")
    .update({
      status: "paid",
      stripe_payment_intent_id: args.paymentIntentId ?? null,
      stripe_checkout_session_id: args.sessionId ?? null,
      paid_at: now,
      unlocked_at: now
    })
    .neq("status", "free")
    .neq("status", "paid");

  if (args.orderId) {
    query = query.eq("id", args.orderId);
  } else if (args.sessionId) {
    query = query.eq("stripe_checkout_session_id", args.sessionId);
  } else {
    return;
  }

  await query;
}

export async function markSearchAccessOrderPaymentFailed(args: {
  orderId?: string | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
}) {
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("search_access_orders")
    .update({
      status: "failed",
      stripe_payment_intent_id: args.paymentIntentId ?? null,
      stripe_checkout_session_id: args.sessionId ?? null
    })
    .neq("status", "free")
    .neq("status", "paid");

  if (args.orderId) {
    query = query.eq("id", args.orderId);
  } else if (args.sessionId) {
    query = query.eq("stripe_checkout_session_id", args.sessionId);
  } else {
    return;
  }

  await query;
}


export async function getSearchAccessOrdersByIds(orderIds: string[]): Promise<SearchAccessOrderRecord[]> {
  const normalizedIds = Array.from(new Set(orderIds.map((item) => item.trim()).filter(Boolean)));

  if (normalizedIds.length === 0) {
    return [];
  }

  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("search_access_orders").select("*").in("id", normalizedIds);
  return (data as SearchAccessOrderRecord[] | null) ?? [];
}

export async function markSearchAccessOrdersPaidByIds(args: {
  orderIds: string[];
  sessionId?: string | null;
  paymentIntentId?: string | null;
}) {
  const orderIds = Array.from(new Set(args.orderIds.map((item) => item.trim()).filter(Boolean)));

  if (orderIds.length === 0) {
    return;
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { error } = await admin
    .from("search_access_orders")
    .update({
      status: "paid",
      stripe_checkout_session_id: args.sessionId ?? null,
      stripe_payment_intent_id: args.paymentIntentId ?? null,
      paid_at: now,
      unlocked_at: now
    })
    .in("id", orderIds)
    .neq("status", "free")
    .neq("status", "paid");

  if (error) {
    throw error;
  }
}

export async function markSearchAccessOrdersPaymentFailedByIds(args: {
  orderIds: string[];
  paymentIntentId?: string | null;
}) {
  const orderIds = Array.from(new Set(args.orderIds.map((item) => item.trim()).filter(Boolean)));

  if (orderIds.length === 0) {
    return;
  }

  const admin = createSupabaseAdminClient();

  await admin
    .from("search_access_orders")
    .update({
      status: "failed",
      stripe_payment_intent_id: args.paymentIntentId ?? null
    })
    .in("id", orderIds)
    .neq("status", "free")
    .neq("status", "paid");
}

export async function getSearchAccessBulkOrderById(orderId: string): Promise<SearchAccessBulkOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("search_access_bulk_orders").select("*").eq("id", orderId).maybeSingle();
  return (data as SearchAccessBulkOrderRecord | null) ?? null;
}

export async function getSearchAccessBulkOrderByCheckoutSessionId(sessionId: string): Promise<SearchAccessBulkOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("search_access_bulk_orders")
    .select("*")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  return (data as SearchAccessBulkOrderRecord | null) ?? null;
}

export async function createSearchAccessBulkOrder(args: {
  profileId?: string | null;
  email?: string | null;
  orders: SearchAccessOrderRecord[];
}) {
  const normalizedOrders = args.orders.filter((order) => !isSearchAccessOrderUnlocked(order.status) && order.total_amount_cents > 0);
  if (normalizedOrders.length === 0) {
    throw new Error("Não há listas pendentes para cobrança em grupo.");
  }

  const orderIds = normalizedOrders.map((order) => order.id);
  const normalizedEmail = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
  let resolvedEmail = normalizedEmail;
  let resolvedProfileId = args.profileId ?? null;

  if (!resolvedProfileId) {
    resolvedProfileId = normalizedOrders.find((order) => typeof order.profile_id === "string" && order.profile_id.trim().length > 0)?.profile_id ?? null;
  }

  if (!resolvedEmail) {
    resolvedEmail = normalizedOrders.find((order) => typeof order.email === "string" && order.email.trim().length > 0)?.email.trim().toLowerCase() ?? "";
  }

  if (!resolvedEmail) {
    throw new Error("Não foi possível determinar o e-mail do checkout em grupo.");
  }

  const totalAmountCents = normalizedOrders.reduce((acc, order) => acc + Math.max(0, order.total_amount_cents), 0);
  const accessToken = crypto.randomBytes(24).toString("hex");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("search_access_bulk_orders")
    .insert({
      access_token: accessToken,
      profile_id: resolvedProfileId,
      email: resolvedEmail,
      order_ids: orderIds,
      order_count: orderIds.length,
      total_amount_cents: totalAmountCents,
      currency: "brl",
      status: totalAmountCents > 0 ? "pending" : "free",
      paid_at: totalAmountCents > 0 ? null : new Date().toISOString(),
      unlocked_at: totalAmountCents > 0 ? null : new Date().toISOString()
    })
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Não foi possível criar o checkout em grupo.");
  }

  return data as SearchAccessBulkOrderRecord;
}

export async function markSearchAccessBulkOrderCheckoutCreated(args: {
  orderId: string;
  customerId?: string | null;
  checkoutSessionId: string;
  checkoutUrl?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("search_access_bulk_orders")
    .update({
      stripe_customer_id: args.customerId ?? null,
      stripe_checkout_session_id: args.checkoutSessionId,
      checkout_url: args.checkoutUrl ?? null,
      status: "pending"
    })
    .eq("id", args.orderId)
    .select("id, stripe_checkout_session_id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Pedido em grupo não encontrado ao registrar sessão de checkout.");
  }

  if (data.stripe_checkout_session_id !== args.checkoutSessionId) {
    throw new Error("Falha ao persistir a sessão do checkout em grupo.");
  }
}

export async function markSearchAccessBulkOrderPaid(args: {
  orderId?: string | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  let query = admin
    .from("search_access_bulk_orders")
    .update({
      status: "paid",
      stripe_payment_intent_id: args.paymentIntentId ?? null,
      stripe_checkout_session_id: args.sessionId ?? null,
      paid_at: now,
      unlocked_at: now
    })
    .neq("status", "free")
    .neq("status", "paid");

  if (args.orderId) {
    query = query.eq("id", args.orderId);
  } else if (args.sessionId) {
    query = query.eq("stripe_checkout_session_id", args.sessionId);
  } else {
    return;
  }

  const { error } = await query;

  if (error) {
    throw error;
  }
}

export async function markSearchAccessBulkOrderPaymentFailed(args: {
  orderId?: string | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("search_access_bulk_orders")
    .update({
      status: "failed",
      stripe_payment_intent_id: args.paymentIntentId ?? null,
      stripe_checkout_session_id: args.sessionId ?? null
    })
    .neq("status", "free")
    .neq("status", "paid");

  if (args.orderId) {
    query = query.eq("id", args.orderId);
  } else if (args.sessionId) {
    query = query.eq("stripe_checkout_session_id", args.sessionId);
  } else {
    return;
  }

  await query;
}

export async function finalizeSearchAccessBulkOrderPayment(args: {
  bulkOrderId?: string | null;
  sessionId: string;
  paymentIntentId?: string | null;
}) {
  const bulkOrder = args.bulkOrderId
    ? await getSearchAccessBulkOrderById(args.bulkOrderId)
    : await getSearchAccessBulkOrderByCheckoutSessionId(args.sessionId);

  if (!bulkOrder) {
    throw new Error("Pedido em lote não encontrado para confirmar o pagamento.");
  }

  const orderIds = normalizeOrderIdsPayload(bulkOrder.order_ids);
  if (orderIds.length === 0) {
    throw new Error(`Pedido em lote ${bulkOrder.id} não possui pedidos individuais vinculados.`);
  }

  const ordersBefore = await getSearchAccessOrdersByIds(orderIds);
  if (ordersBefore.length !== orderIds.length) {
    throw new Error(
      `Inconsistência no pedido em lote ${bulkOrder.id}: esperados ${orderIds.length} pedidos, encontrados ${ordersBefore.length}.`
    );
  }

  await markSearchAccessOrdersPaidByIds({
    orderIds,
    sessionId: args.sessionId,
    paymentIntentId: args.paymentIntentId ?? null
  });

  const ordersAfter = await getSearchAccessOrdersByIds(orderIds);
  const pendingOrders = ordersAfter.filter(
    (order) => !isSearchAccessOrderUnlocked(order.status) || !order.paid_at || !order.unlocked_at
  );

  if (pendingOrders.length > 0) {
    throw new Error(
      `Pedido em lote ${bulkOrder.id} ficou inconsistente: ${pendingOrders.length} pedido(s) individual(is) seguem bloqueados.`
    );
  }

  if (!isSearchAccessBulkOrderUnlocked(bulkOrder.status)) {
    await markSearchAccessBulkOrderPaid({
      orderId: bulkOrder.id,
      sessionId: args.sessionId,
      paymentIntentId: args.paymentIntentId ?? null
    });
  }

  const updatedBulkOrder = await getSearchAccessBulkOrderById(bulkOrder.id);
  if (!updatedBulkOrder || !isSearchAccessBulkOrderUnlocked(updatedBulkOrder.status)) {
    throw new Error(`Falha ao consolidar pagamento do pedido em lote ${bulkOrder.id}.`);
  }

  return {
    bulkOrder: updatedBulkOrder,
    orders: ordersAfter
  };
}

async function unlockSearchAccessBulkOrderFromCheckoutSession(session: Stripe.Checkout.Session) {
  const bulkOrderId = typeof session.metadata?.bulk_order_id === "string" ? session.metadata.bulk_order_id : null;
  await finalizeSearchAccessBulkOrderPayment({
    bulkOrderId,
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
  });
}
export async function getSearchAiFormatOrderById(orderId: string): Promise<SearchAiFormatOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("search_ai_format_orders").select("*").eq("id", orderId).maybeSingle();
  return (data as SearchAiFormatOrderRecord | null) ?? null;
}

export async function getSearchAiFormatOrderBySearchQueryId(
  searchQueryId: string
): Promise<SearchAiFormatOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("search_ai_format_orders")
    .select("*")
    .eq("search_query_id", searchQueryId)
    .maybeSingle();
  return (data as SearchAiFormatOrderRecord | null) ?? null;
}

export async function getSearchAiFormatOrderByCheckoutSessionId(
  sessionId: string
): Promise<SearchAiFormatOrderRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("search_ai_format_orders")
    .select("*")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  return (data as SearchAiFormatOrderRecord | null) ?? null;
}

export async function ensureSearchAiFormatOrderForSearch(args: {
  searchQueryId: string;
  profileId?: string | null;
  email?: string | null;
}): Promise<SearchAiFormatOrderRecord> {
  const admin = createSupabaseAdminClient();
  const normalizedEmail = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
  let resolvedProfileId = args.profileId ?? null;
  let resolvedEmail = normalizedEmail;

  const existing = await getSearchAiFormatOrderBySearchQueryId(args.searchQueryId);

  if (!resolvedProfileId || !resolvedEmail) {
    const { data: search, error: searchError } = await admin
      .from("search_queries")
      .select("profile_id")
      .eq("id", args.searchQueryId)
      .maybeSingle();

    if (searchError || !search) {
      throw searchError ?? new Error("Não foi possível localizar a busca da formatação por IA.");
    }

    resolvedProfileId = resolvedProfileId ?? search.profile_id ?? null;
  }

  if (!resolvedEmail && resolvedProfileId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("id", resolvedProfileId)
      .maybeSingle();

    resolvedEmail = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
  }

  if (!resolvedEmail) {
    throw new Error("Não foi possível determinar o e-mail da cobrança de formatação por IA.");
  }

  if (existing) {
    const updates: Partial<SearchAiFormatOrderRecord> = {};

    if (resolvedProfileId && existing.profile_id !== resolvedProfileId) {
      updates.profile_id = resolvedProfileId;
    }

    if (existing.email !== resolvedEmail) {
      updates.email = resolvedEmail;
    }

    if (existing.amount_cents !== getAiFormattingPriceCents()) {
      updates.amount_cents = getAiFormattingPriceCents();
    }

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const { data: updatedOrder, error: updateError } = await admin
      .from("search_ai_format_orders")
      .update(updates)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError || !updatedOrder) {
      throw updateError ?? new Error("Não foi possível atualizar a cobrança de formatação por IA.");
    }

    return updatedOrder as SearchAiFormatOrderRecord;
  }

  const accessToken = crypto.randomBytes(24).toString("hex");
  const { data: insertedOrder, error: insertError } = await admin
    .from("search_ai_format_orders")
    .insert({
      access_token: accessToken,
      profile_id: resolvedProfileId,
      email: resolvedEmail,
      search_query_id: args.searchQueryId,
      amount_cents: getAiFormattingPriceCents(),
      currency: "brl",
      status: "pending"
    })
    .select("*")
    .single();

  if (insertError || !insertedOrder) {
    if ((insertError as { code?: string } | null)?.code === "23505") {
      const concurrentOrder = await getSearchAiFormatOrderBySearchQueryId(args.searchQueryId);
      if (concurrentOrder) {
        return concurrentOrder;
      }
    }

    throw insertError ?? new Error("Não foi possível criar a cobrança de formatação por IA.");
  }

  return insertedOrder as SearchAiFormatOrderRecord;
}

export async function syncSearchAiFormatOrderPaymentStatus(order: SearchAiFormatOrderRecord) {
  if (isSearchAiFormatOrderUnlocked(order.status)) {
    return order;
  }

  if (!order.stripe_checkout_session_id) {
    return order;
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);

  if (session.payment_status === "paid") {
    await markSearchAiFormatOrderPaid({
      orderId: order.id,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });

    return (await getSearchAiFormatOrderById(order.id)) ?? order;
  }

  if (session.status === "expired") {
    await markSearchAiFormatOrderPaymentFailed({
      orderId: order.id,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });

    return (await getSearchAiFormatOrderById(order.id)) ?? order;
  }

  return order;
}

export async function markSearchAiFormatOrderCheckoutCreated(args: {
  orderId: string;
  customerId?: string | null;
  checkoutSessionId: string;
  checkoutUrl?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("search_ai_format_orders")
    .update({
      stripe_customer_id: args.customerId ?? null,
      stripe_checkout_session_id: args.checkoutSessionId,
      checkout_url: args.checkoutUrl ?? null,
      status: "pending"
    })
    .eq("id", args.orderId);
}

export async function markSearchAiFormatOrderPaid(args: {
  orderId?: string | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  let query = admin
    .from("search_ai_format_orders")
    .update({
      status: "paid",
      stripe_payment_intent_id: args.paymentIntentId ?? null,
      stripe_checkout_session_id: args.sessionId ?? null,
      paid_at: now,
      unlocked_at: now
    })
    .neq("status", "paid");

  if (args.orderId) {
    query = query.eq("id", args.orderId);
  } else if (args.sessionId) {
    query = query.eq("stripe_checkout_session_id", args.sessionId);
  } else {
    return;
  }

  await query;
}

export async function markSearchAiFormatOrderPaymentFailed(args: {
  orderId?: string | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
}) {
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("search_ai_format_orders")
    .update({
      status: "failed",
      stripe_payment_intent_id: args.paymentIntentId ?? null,
      stripe_checkout_session_id: args.sessionId ?? null
    })
    .neq("status", "paid");

  if (args.orderId) {
    query = query.eq("id", args.orderId);
  } else if (args.sessionId) {
    query = query.eq("stripe_checkout_session_id", args.sessionId);
  } else {
    return;
  }

  await query;
}

export async function saveSearchAiFormatPayload(args: {
  orderId: string;
  payload: unknown;
  error?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("search_ai_format_orders")
    .update({
      formatted_payload: args.payload,
      format_error: args.error ?? null,
      formatted_at: new Date().toISOString()
    })
    .eq("id", args.orderId);
}

async function unlockSearchAccessOrderFromCheckoutSession(session: Stripe.Checkout.Session) {
  const orderId = typeof session.metadata?.order_id === "string" ? session.metadata.order_id : null;
  const order = orderId
    ? await getSearchAccessOrderById(orderId)
    : await getSearchAccessOrderByCheckoutSessionId(session.id);

  if (!order || isSearchAccessOrderUnlocked(order.status)) {
    return;
  }

  await markSearchAccessOrderPaid({
    orderId: order.id,
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
  });
}

async function unlockSearchAiFormatOrderFromCheckoutSession(session: Stripe.Checkout.Session) {
  const orderId = typeof session.metadata?.order_id === "string" ? session.metadata.order_id : null;
  const order = orderId
    ? await getSearchAiFormatOrderById(orderId)
    : await getSearchAiFormatOrderByCheckoutSessionId(session.id);

  if (!order || isSearchAiFormatOrderUnlocked(order.status)) {
    return;
  }

  await markSearchAiFormatOrderPaid({
    orderId: order.id,
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
  });
}

async function failOrderFromCheckoutSession(session: Stripe.Checkout.Session, orderType: string | null) {
  if (orderType === "search_ai_format") {
    await markSearchAiFormatOrderPaymentFailed({
      orderId: typeof session.metadata?.order_id === "string" ? session.metadata.order_id : null,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });
    return;
  }

  if (orderType === "search_access_bundle") {
    const bulkOrderId = typeof session.metadata?.bulk_order_id === "string" ? session.metadata.bulk_order_id : null;
    const bulkOrder = bulkOrderId
      ? await getSearchAccessBulkOrderById(bulkOrderId)
      : await getSearchAccessBulkOrderByCheckoutSessionId(session.id);

    await markSearchAccessBulkOrderPaymentFailed({
      orderId: bulkOrder?.id ?? bulkOrderId,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });

    await markSearchAccessOrdersPaymentFailedByIds({
      orderIds: bulkOrder ? normalizeOrderIdsPayload(bulkOrder.order_ids) : [],
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
    });
    return;
  }

  await markSearchAccessOrderPaymentFailed({
    orderId: typeof session.metadata?.order_id === "string" ? session.metadata.order_id : null,
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
  });
}

export async function handleStripeWebhook(event: Stripe.Event) {
  const fresh = await registerWebhookEvent(event.id, event.type, event.data.object);
  if (!fresh) return;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderType = typeof session.metadata?.order_type === "string" ? session.metadata.order_type : "search_access";
      if (session.customer) {
        await syncStripeCustomer(String(session.customer));
      }
      if (session.mode === "payment" && session.payment_status === "paid") {
        if (orderType === "search_ai_format") {
          await unlockSearchAiFormatOrderFromCheckoutSession(session);
        } else if (orderType === "search_access_bundle") {
          await unlockSearchAccessBulkOrderFromCheckoutSession(session);
        } else {
          await unlockSearchAccessOrderFromCheckoutSession(session);
        }
      }
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderType = typeof session.metadata?.order_type === "string" ? session.metadata.order_type : "search_access";
      if (session.customer) {
        await syncStripeCustomer(String(session.customer));
      }
      if (orderType === "search_ai_format") {
        await unlockSearchAiFormatOrderFromCheckoutSession(session);
      } else if (orderType === "search_access_bundle") {
        await unlockSearchAccessBulkOrderFromCheckoutSession(session);
      } else {
        await unlockSearchAccessOrderFromCheckoutSession(session);
      }
      break;
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderType = typeof session.metadata?.order_type === "string" ? session.metadata.order_type : "search_access";
      await failOrderFromCheckoutSession(session, orderType);
      break;
    }
    case "customer.updated": {
      const customer = event.data.object as Stripe.Customer;
      await syncStripeCustomer(customer.id, customer);
      break;
    }
    default:
      break;
  }
}
