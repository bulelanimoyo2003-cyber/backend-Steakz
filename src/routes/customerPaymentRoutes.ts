import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { calculateCheckoutAmounts, roundPrice } from '../lib/checkoutPricing.js';
import prisma from '../lib/prisma.js';
import { getFrontendOrigin, getStripeClient } from '../lib/stripe.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['CUSTOMER']));

router.get('/payment-methods', (_req: Request, res: Response) => {
  const stripe = getStripeClient();
  res.json({
    methods: [
      { id: 'CASH', label: 'Cash at the cashier' },
      ...(stripe ? [{ id: 'STRIPE', label: 'Card (Stripe test mode)' }] : []),
    ],
  });
});

router.post('/orders/quote', async (req: Request, res: Response) => {
  const { branchId, orderType, items } = req.body as {
    branchId?: number;
    orderType?: string;
    items?: { menuItemId: number; quantity: number }[];
  };
  if (!Number.isInteger(branchId) || !branchId || !['DINE_IN', 'COLLECTION', 'DELIVERY'].includes(orderType ?? '')
    || !Array.isArray(items) || items.length === 0 || items.length > 50
    || items.some((item) => !item || !Number.isInteger(item.menuItemId) || item.menuItemId <= 0
      || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 50)) {
    res.status(400).json({ error: 'Choose a valid branch, order type, and between 1 and 50 valid menu items.' });
    return;
  }
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: { id: true },
  });
  if (!branch) {
    res.status(400).json({ error: 'This location is no longer active. Please select an active location.' });
    return;
  }
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((item) => item.menuItemId) }, branchId, isAvailable: true },
    select: { id: true, price: true },
  });
  if (menuItems.length !== items.length) {
    res.status(400).json({ error: 'One or more menu items are invalid or unavailable at this location.' });
    return;
  }
  const priceById = new Map(menuItems.map((item) => [item.id, item.price]));
  const amounts = calculateCheckoutAmounts(items.map((item) => ({
    ...item,
    price: priceById.get(item.menuItemId) ?? 0,
  })), orderType!);
  res.json({
    ...amounts,
    pricingNote: 'No discount or delivery fee is configured for this branch.',
  });
});

router.post('/orders/:id/checkout', async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: 'Invalid order id.' });
    return;
  }
  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: 'Online card payments are not configured. Choose cash at the cashier.' });
    return;
  }
  const customerId = req.user!.id;
  let order = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    include: { items: { include: { menuItem: { select: { name: true } } } } },
  });
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (order.paymentMethod !== 'STRIPE') {
    res.status(409).json({ error: 'This order is not configured for online payment.' });
    return;
  }
  if (order.paymentStatus === 'PAID') {
    res.json({ orderId, paymentStatus: 'PAID', checkoutUrl: null });
    return;
  }
  if (order.total <= 0) {
    res.status(400).json({ error: 'Online payment requires a positive order total.' });
    return;
  }

  if (order.paymentSessionId) {
    const previousSession = await stripe.checkout.sessions.retrieve(order.paymentSessionId);
    if (previousSession.payment_status === 'paid') {
      res.json({ orderId, paymentStatus: order.paymentStatus, checkoutUrl: null, awaitingWebhook: true });
      return;
    }
    if (previousSession.status === 'open' && previousSession.url) {
      res.json({ orderId, paymentStatus: order.paymentStatus, checkoutUrl: previousSession.url });
      return;
    }
    if (previousSession.status === 'expired') {
      await prisma.order.updateMany({
        where: { id: order.id, customerId, paymentSessionId: previousSession.id, paymentStatus: { in: ['PENDING', 'FAILED', 'CANCELLED'] } },
        data: { paymentStatus: 'CANCELLED' },
      });
      order = await prisma.order.findFirst({
        where: { id: order.id, customerId },
        include: { items: { include: { menuItem: { select: { name: true } } } } },
      });
      if (!order) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }
    } else {
      res.status(409).json({ error: 'Payment is being confirmed. Refresh the order history before retrying.' });
      return;
    }
  }

  const retryingUnfinishedAttempt = order.paymentStatus === 'PENDING'
    && !order.paymentSessionId
    && Boolean(order.paymentAttemptId);
  if (!retryingUnfinishedAttempt && !['UNPAID', 'FAILED', 'CANCELLED'].includes(order.paymentStatus)) {
    res.status(409).json({ error: 'This order is not eligible for another payment attempt.' });
    return;
  }
  const paymentAttemptId = retryingUnfinishedAttempt ? order.paymentAttemptId! : randomUUID();
  if (!retryingUnfinishedAttempt) {
    const started = await prisma.order.updateMany({
      where: {
        id: order.id,
        customerId,
        paymentMethod: 'STRIPE',
        paymentStatus: { in: ['UNPAID', 'FAILED', 'CANCELLED'] },
        paymentSessionId: order.paymentSessionId,
      },
      data: {
        paymentStatus: 'PENDING',
        paymentAttemptId,
        paymentSessionId: null,
        paymentCheckoutUrl: null,
        paymentSessionExpiresAt: null,
      },
    });
    if (started.count !== 1) {
      res.status(409).json({ error: 'Payment status changed; refresh the order before retrying.' });
      return;
    }
  }

  let createdSession: Stripe.Checkout.Session | null = null;
  try {
    const frontendOrigin = getFrontendOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      allowed_payment_method_types: ['card'],
      line_items: order.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: Math.round(roundPrice(item.unitPrice) * 100),
          product_data: { name: item.menuItem.name },
        },
      })),
      client_reference_id: String(order.id),
      metadata: { orderId: String(order.id), paymentAttemptId },
      payment_intent_data: { metadata: { orderId: String(order.id), paymentAttemptId } },
      success_url: `${frontendOrigin}/payment-result?status=success&orderId=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendOrigin}/payment-result?status=cancelled&orderId=${order.id}`,
    }, { idempotencyKey: `steakz-order-${order.id}-${paymentAttemptId}` });
    createdSession = session;
    if (!session.url || !session.expires_at) {
      throw new Error('Stripe Checkout did not return a usable hosted session.');
    }
    const saved = await prisma.order.updateMany({
      where: { id: order.id, customerId, paymentAttemptId, paymentStatus: 'PENDING' },
      data: {
        paymentSessionId: session.id,
        paymentCheckoutUrl: session.url,
        paymentSessionExpiresAt: new Date(session.expires_at * 1000),
      },
    });
    if (saved.count !== 1) {
      await stripe.checkout.sessions.expire(session.id);
      res.status(409).json({ error: 'Payment status changed while creating checkout. Refresh the order.' });
      return;
    }
    res.json({ orderId, paymentStatus: 'PENDING', checkoutUrl: session.url });
  } catch {
    if (createdSession) {
      try {
        const latestSession = await stripe.checkout.sessions.retrieve(createdSession.id);
        if (latestSession.status === 'open') await stripe.checkout.sessions.expire(createdSession.id);
      } catch {
        console.error('[Stripe] Could not safely expire an unpersisted checkout session.');
      }
    }
    console.error('[Stripe] Checkout session creation failed.');
    res.status(502).json({ error: 'Unable to start secure checkout. Payment is pending; safely retry from order history.' });
  }
});

router.post('/orders/:id/payment/cancel', async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: 'Invalid order id.' });
    return;
  }
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: req.user!.id },
  });
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (order.paymentMethod !== 'STRIPE' || !order.paymentSessionId) {
    res.status(409).json({ error: 'There is no active online payment session to cancel.' });
    return;
  }
  if (order.paymentStatus === 'PAID') {
    res.json({ paymentStatus: 'PAID' });
    return;
  }
  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: 'Online payments are not configured.' });
    return;
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(order.paymentSessionId);
    if (session.payment_status === 'paid') {
      res.json({ paymentStatus: order.paymentStatus, awaitingWebhook: true });
      return;
    }
    if (session.status === 'open') session = await stripe.checkout.sessions.expire(session.id);
  } catch {
    console.error('[Stripe] Checkout cancellation could not be confirmed.');
    res.status(502).json({ error: 'The provider could not confirm cancellation. Payment status has not been changed.' });
    return;
  }
  if (session.status !== 'expired') {
    res.status(409).json({ error: 'Checkout cannot be cancelled while the provider is confirming payment.' });
    return;
  }
  await prisma.order.updateMany({
    where: {
      id: order.id,
      customerId: req.user!.id,
      paymentSessionId: session.id,
      paymentStatus: { in: ['PENDING', 'FAILED', 'CANCELLED'] },
    },
    data: { paymentStatus: 'CANCELLED' },
  });
  const updated = await prisma.order.findFirst({ where: { id: order.id, customerId: req.user!.id } });
  res.json({ paymentStatus: updated?.paymentStatus ?? 'CANCELLED' });
});

router.get('/orders/:id/payment', async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: 'Invalid order id.' });
    return;
  }
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: req.user!.id },
    select: {
      id: true,
      total: true,
      subtotal: true,
      discountTotal: true,
      deliveryFee: true,
      currency: true,
      paymentStatus: true,
      paymentMethod: true,
      paymentSessionExpiresAt: true,
      createdAt: true,
    },
  });
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  res.set('Cache-Control', 'no-store').json(order);
});

export default router;
