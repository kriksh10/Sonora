import {
  CREDIT_PACKS,
  PLANS,
  findSku,
  isPlan,
  type SkuId,
} from "@workspace/pricing";
import Stripe from "stripe";

export type CheckoutResult =
  | { comingSoon: true }
  | { comingSoon: false; url: string };

export function stripeConfigured(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhook = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret || !webhook) return false;
  if (secret.startsWith("sk_live") || secret.startsWith("rk_live")) return false;
  return secret.startsWith("sk_test") || secret.startsWith("rk_test");
}

export function stripeClient(env: NodeJS.ProcessEnv = process.env) {
  if (!stripeConfigured(env)) return null;
  return new Stripe(env.STRIPE_SECRET_KEY!.trim());
}

/** Test-mode Checkout only. Missing or live keys return Coming soon instead of throwing. */
export async function createTestCheckout(input: {
  userId: string;
  sku: string;
  successUrl: string;
  cancelUrl: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CheckoutResult> {
  const env = input.env ?? process.env;
  const stripe = stripeClient(env);
  const item = findSku(input.sku);
  if (!stripe || !item) return { comingSoon: true };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.userId,
    metadata: { userId: input.userId, sku: item.id },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: item.priceCents,
          product_data: {
            name: isPlan(item) ? item.name : `${item.credits} Sonora credit${item.credits === 1 ? "" : "s"}`,
          },
        },
      },
    ],
  });
  if (!session.url) return { comingSoon: true };
  return { comingSoon: false, url: session.url };
}

export type Grant = { userId: string; sku: SkuId; credits: number; unlimitedHours: number; checkoutId: string };

export function grantFromCheckout(session: Stripe.Checkout.Session): Grant | null {
  if (!session.id || session.payment_status !== "paid" || session.livemode) return null;
  const userId = session.metadata?.userId || session.client_reference_id || "";
  const sku = session.metadata?.sku ?? "";
  const item = findSku(sku);
  if (!userId || !item) return null;
  if (session.currency !== "usd" || session.amount_total !== item.priceCents) return null;
  if (isPlan(item)) return { userId, sku: item.id, credits: 0, unlimitedHours: item.durationHours, checkoutId: session.id };
  return { userId, sku: item.id, credits: item.credits, unlimitedHours: 0, checkoutId: session.id };
}

export function readPaidCheckout(rawBody: string, signature: string, env: NodeJS.ProcessEnv = process.env): Grant | null {
  const stripe = stripeClient(env);
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) return null;
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  if (event.type !== "checkout.session.completed") return null;
  return grantFromCheckout(event.data.object as Stripe.Checkout.Session);
}

export function catalogForClient() {
  return {
    priceStatus: "TODO-confirm" as const,
    checkout: stripeConfigured(),
    plans: PLANS,
    packs: CREDIT_PACKS,
    freeSessions: 10,
    freeMinutes: 10,
    blockMinutes: 30,
  };
}
