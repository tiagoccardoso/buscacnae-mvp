import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe";

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

function isSearchAccessOrderUnlocked(status: string) {
  return status === "paid" || status === "free";
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


export async function syncSearchAccessOrderPaymentStatus(order: SearchAccessOrderRecord) {
  if (isSearchAccessOrderUnlocked(order.status)) {
    return order;
  }

  if (!order.stripe_checkout_session_id) {
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

async function unlockOrderFromCheckoutSession(session: Stripe.Checkout.Session) {
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

export async function handleStripeWebhook(event: Stripe.Event) {
  const fresh = await registerWebhookEvent(event.id, event.type, event.data.object);
  if (!fresh) return;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.customer) {
        await syncStripeCustomer(String(session.customer));
      }
      if (session.mode === "payment" && session.payment_status === "paid") {
        await unlockOrderFromCheckoutSession(session);
      }
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.customer) {
        await syncStripeCustomer(String(session.customer));
      }
      await unlockOrderFromCheckoutSession(session);
      break;
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await markSearchAccessOrderPaymentFailed({
        orderId: typeof session.metadata?.order_id === "string" ? session.metadata.order_id : null,
        sessionId: session.id,
        paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null
      });
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
