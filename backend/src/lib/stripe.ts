import Stripe from 'stripe';

let client: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!secretKey && !webhookSecret) return null;
  if (!secretKey?.startsWith('sk_test_') || !webhookSecret?.startsWith('whsec_')) {
    throw new Error('Stripe test mode requires STRIPE_SECRET_KEY (sk_test_) and STRIPE_WEBHOOK_SECRET (whsec_).');
  }
  if (!client) client = new Stripe(secretKey);
  return client;
}

export function getStripeWebhookSecret(): string {
  const stripe = getStripeClient();
  if (!stripe) throw new Error('Stripe is not configured.');
  return process.env.STRIPE_WEBHOOK_SECRET!.trim();
}

export function getFrontendOrigin(): string {
  const origin = process.env.FRONTEND_URL?.trim().replace(/\/+$/, '');
  if (!origin) throw new Error('FRONTEND_URL must be configured for Stripe Checkout.');
  return origin;
}
