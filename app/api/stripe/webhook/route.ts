import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeWebhookSecret } from "@/lib/env";
import { getStripeClient } from "@/lib/stripe";
import { handleStripeWebhook } from "@/lib/billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return new NextResponse("Missing stripe-signature header", { status: 400 });
  }

  const stripe = getStripeClient();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, getStripeWebhookSecret());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature";
    return new NextResponse(message, { status: 400 });
  }

  try {
    await handleStripeWebhook(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing error";
    return new NextResponse(message, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
