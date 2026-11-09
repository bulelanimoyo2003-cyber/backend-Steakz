import fs from 'fs';
import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole, requireBranch } from '../middleware/auth.js';
import { calculateCheckoutAmounts, roundPrice } from '../lib/checkoutPricing.js';

const logFile = 'cashier_debug.log';
function debugLog(message: string) {
  const ts = new Date().toISOString();
  fs.appendFileSync(logFile, `[${ts}] ${message}\n`);
}

async function completeBookingIfOrderPaidAndDelivered(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { booking: true },
  });

  if (!order || !order.booking) {
    return;
  }

  if (order.paymentStatus !== 'PAID' || order.status !== 'DELIVERED') {
    return;
  }

  if (order.booking.status === 'COMPLETED' || order.booking.status === 'CANCELLED') {
    return;
  }

  const bookingId = order.bookingId;
  if (!bookingId) {
    return;
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'COMPLETED' },
  });

  await prisma.table.update({
    where: { id: order.booking.tableId },
    data: { status: 'CLEANING' as any },
  });
}

const router = Router();
router.use(verifyToken, requireRole(['CASHIER']), requireBranch);

router.post('/orders', async (req: Request, res: Response) => {
  const branchId = req.user!.branchId!;
  // allow client to optionally pass customerId/bookingId, but validate types
  const { customerId, bookingId, items } = req.body as {
    customerId?: number | string;
    bookingId?: number | string;
    items?: { menuItemId: number | string; quantity: number | string }[];
  };

  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'At least one item is required.' });
      return;
    }

    // Normalize and validate items
    const normItems = items.map((it, idx) => {
      const menuItemId = Number(it.menuItemId);
      const quantity = Number(it.quantity);
      if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
        throw new Error(`Invalid menuItemId at index ${idx}`);
      }
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 50) {
        throw new Error(`Invalid quantity for menuItemId ${menuItemId}`);
      }
      return { menuItemId, quantity };
    });

    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: normItems.map((item) => item.menuItemId) }, branchId, isAvailable: true },
      select: { id: true, price: true },
    });

    if (menuItems.length !== normItems.length) {
      res.status(400).json({ error: 'One or more menu items are invalid for this branch.' });
      return;
    }

    const priceMap = Object.fromEntries(menuItems.map((item: { id: number; price: number }) => [
      item.id,
      roundPrice(item.price),
    ]));
    const amounts = calculateCheckoutAmounts(normItems.map((item) => ({
      ...item,
      price: priceMap[item.menuItemId] ?? 0,
    })), 'COLLECTION');

    const order = await prisma.order.create({
      data: {
        branchId,
        paymentMethod: 'CASH',
        customerId: customerId ? Number(customerId) : null,
        bookingId: bookingId ? Number(bookingId) : null,
        subtotal: amounts.subtotal,
        discountTotal: amounts.discountTotal,
        deliveryFee: amounts.deliveryFee,
        currency: amounts.currency,
        total: amounts.total,
        items: {
          create: normItems.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            unitPrice: priceMap[item.menuItemId] ?? 0,
          })),
        },
      },
      include: { items: { include: { menuItem: true } } },
    });

    res.status(201).json(order);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    debugLog(`[CASHIER CREATE ORDER] error: ${msg}`);
    console.error('[CASHIER CREATE ORDER] error', error);
    const status = (error instanceof Error && /Invalid|required|missing/i.test(error.message)) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get('/orders', async (req: Request, res: Response) => {
  try {
    const branchId = req.user!.branchId!;
    debugLog(`[CASHIER ORDERS] hit branchId=${branchId}, user=${req.user?.id}`);
    const orders = await prisma.order.findMany({
      where: { branchId },
      select: {
        id: true,
        total: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        orderType: true,
        deliveryStatus: true,
        createdAt: true,
        items: { select: { quantity: true, unitPrice: true, menuItem: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    debugLog(`[CASHIER ORDERS] found ${orders.length} orders`);
    res.json(orders);
  } catch (error) {
    debugLog(`[CASHIER ORDERS] error ${error}`);
    console.error('[CASHIER ORDERS] error', error);
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

router.get('/menu', async (req: Request, res: Response) => {
  const branchId = req.user!.branchId!;
  const items = await prisma.menuItem.findMany({
    where: { branchId, isAvailable: true },
    orderBy: { category: 'asc' },
  });
  res.json(items);
});

router.patch('/orders/:id/pay', async (req: Request, res: Response) => {
  try {
    const branchId = req.user!.branchId!;
    const id = Number(req.params.id);
    console.log(`[CASHIER PAY] route hit for order ${id}, user ${req.user?.id}, branch ${branchId}`);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.branchId !== branchId) {
      res.status(403).json({ error: 'Order not found in your branch.' });
      return;
    }
    if (order.paymentMethod === 'STRIPE') {
      res.status(409).json({ error: 'Online payments can only be confirmed by the verified payment provider.' });
      return;
    }
    if (order.paymentStatus === 'PAID') {
      res.json(order);
      return;
    }
    const paidAt = new Date();
    const updatedCount = await prisma.order.updateMany({
      where: { id, branchId, paymentStatus: 'UNPAID', OR: [{ paymentMethod: 'CASH' }, { paymentMethod: null }] },
      data: { paymentStatus: 'PAID', paidAt },
    });
    const updated = await prisma.order.findUnique({ where: { id } });
    if (!updated) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (updatedCount.count === 0 && updated.paymentStatus !== 'PAID') {
      res.status(409).json({ error: 'Order payment status changed; reload before trying again.' });
      return;
    }
    await completeBookingIfOrderPaidAndDelivered(updated.id);
    res.json(updated);
  } catch (error) {
    console.error('[CASHIER PAY] error', error);
    res.status(500).json({ error: 'Failed to update order payment status.' });
  }
});

router.patch('/orders/:id/deliver', async (req: Request, res: Response) => {
  try {
    const branchId = req.user!.branchId!;
    const id = Number(req.params.id);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.branchId !== branchId) {
      res.status(403).json({ error: 'Order not found in your branch.' });
      return;
    }
    if (order.orderType === 'DELIVERY') {
      res.status(409).json({ error: 'Delivery orders must be marked delivered by the assigned driver.' });
      return;
    }
    if (order.orderType === 'COLLECTION' && (order.status !== 'DONE' || order.paymentStatus !== 'PAID')) {
      res.status(409).json({ error: 'Collection is only available after the kitchen marks the order ready and payment is confirmed.' });
      return;
    }
    const updated = await prisma.order.updateMany({
      where: {
        id,
        branchId,
        orderType: { not: 'DELIVERY' },
        ...(order.orderType === 'COLLECTION' ? { status: 'DONE', paymentStatus: 'PAID' } : {}),
      },
      data: { status: 'DELIVERED' },
    });
    if (updated.count !== 1) {
      res.status(409).json({ error: 'Order status changed or order not found in your branch.' });
      return;
    }
    const deliveredOrder = await prisma.order.findUnique({ where: { id } });
    if (!deliveredOrder) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    await completeBookingIfOrderPaidAndDelivered(deliveredOrder.id);
    res.json(deliveredOrder);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order delivery status.' });
  }
});

export default router;
