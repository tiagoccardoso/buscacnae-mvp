import Stripe from "stripe";
import { getStripeSecretKey } from "@/lib/env";

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  if (!stripeClient) {
    stripeClient = new Stripe(getStripeSecretKey());
  }
  return stripeClient;
}

export async function createOneTimeCheckoutSession({
  customerId,
  amountCents,
  currency,
  orderId,
  orderAccessToken,
  successUrl,
  cancelUrl,
  customerEmail
}: {
  customerId?: string | null;
  amountCents: number;
  currency?: string;
  orderId: string;
  orderAccessToken: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
}) {
  const stripe = getStripeClient();

  return stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId ?? undefined,
    customer_email: customerId ? undefined : customerEmail ?? undefined,
    billing_address_collection: "auto",
    allow_promotion_codes: false,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: (currency || "brl").toLowerCase(),
          unit_amount: amountCents,
          product_data: {
            name: "Acesso à lista de CNPJs da pesquisa",
            description: `Pedido ${orderId}`
          }
        }
      }
    ],
    metadata: {
      order_id: orderId,
      access_token: orderAccessToken
    },
    success_url: successUrl,
    cancel_url: cancelUrl
  });
}
