import { Router } from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import prisma from '../lib/prisma.js';
import { getStripeClient, getStripeWebhookSecret } from '../lib/stripe.js';

const router = Router();

function isDuplicateEvent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

router.post('/', async (req: Request, res: Response) => {
  const stripe = getStripeClient();
  const signature = req.header('stripe-signature');
  if (!stripe || !signature || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'A valid Stripe webhook signature and raw request body are required.' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, getStripeWebhookSecret());
  } catch {
    res.status(400).json({ error: 'Invalid Stripe webhook signature.' });
    return;
  }

  let orderIdText: string | null = null;
  let paymentAttemptId: string | null = null;
  let sessionId: string | null = null;
  let amount: number | null = null;
  let currency: string | null = null;
  let nextStatus: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | null = null;

  if (event.type.startsWith('checkout.session.')) {
    const session = event.data.object as Stripe.Checkout.Session;
    orderIdText = session.metadata?.orderId ?? null;
    paymentAttemptId = session.metadata?.paymentAttemptId ?? null;
    sessionId = session.id;
    amount = session.amount_total;
    currency = session.currency;
    if (session.mode !== 'payment' || session.client_reference_id !== orderIdText) {
      res.status(400).json({ error: 'Checkout session reference is invalid.' });
      return;
    }
    if (event.type === 'checkout.session.completed') {
      nextStatus = session.payment_status === 'paid' ? 'PAID' : 'PENDING';
    } else if (event.type === 'checkout.session.async_payment_succeeded') {
      nextStatus = 'PAID';
    } else if (event.type === 'checkout.session.async_payment_failed') {
      nextStatus = 'FAILED';
    } else if (event.type === 'checkout.session.expired') {
      nextStatus = 'CANCELLED';
    }
  } else if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    orderIdText = intent.metadata?.orderId ?? null;
    paymentAttemptId = intent.metadata?.paymentAttemptId ?? null;
    amount = intent.amount;
    currency = intent.currency;
    nextStatus = event.type === 'payment_intent.succeeded' ? 'PAID' : 'FAILED';
  } else {
    res.json({ received: true });
    return;
  }

  const orderId = Number(orderIdText);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !paymentAttemptId || amount === null || !currency) {
    res.status(400).json({ error: 'Payment event is missing its verified order reference or amount.' });
    return;
  }
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.paymentMethod !== 'STRIPE'
    || Math.round(order.total * 100) !== amount
    || order.currency.toLowerCase() !== currency.toLowerCase()) {
    res.status(400).json({ error: 'Payment event does not match an order amount and currency.' });
    return;
  }
  if (sessionId && (sessionId !== order.paymentSessionId || paymentAttemptId !== order.paymentAttemptId)) {
    res.json({ received: true });
    return;
  }
  if (!sessionId && paymentAttemptId !== order.paymentAttemptId) {
    res.json({ received: true });
    return;
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.paymentEvent.create({
        data: { providerEventId: event.id, eventType: event.type, orderId: order.id },
      });
      if (order.paymentStatus === 'PAID' || !nextStatus) return;

      const where = {
        id: order.id,
        paymentMethod: 'STRIPE' as const,
        paymentAttemptId,
        ...(sessionId ? { paymentSessionId: sessionId } : {}),
      };
      if (nextStatus === 'PAID') {
        await transaction.order.updateMany({
          where: { ...where, paymentStatus: { not: 'PAID' } },
          data: { paymentStatus: 'PAID', paidAt: new Date() },
        });
      } else if (nextStatus === 'FAILED') {
        await transaction.order.updateMany({
          where: { ...where, paymentStatus: 'PENDING' },
          data: { paymentStatus: 'FAILED' },
        });
      } else if (nextStatus === 'CANCELLED') {
        await transaction.order.updateMany({
          where: { ...where, paymentStatus: { in: ['PENDING', 'FAILED'] } },
          data: { paymentStatus: 'CANCELLED' },
        });
      }
    });
  } catch (error) {
    if (isDuplicateEvent(error)) {
      res.json({ received: true, duplicate: true });
      return;
    }
    throw error;
  }

  res.json({ received: true });
});

export default router;
