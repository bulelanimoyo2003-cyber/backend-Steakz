import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['CUSTOMER']));

router.get('/bookings', async (req: Request, res: Response) => {
  const customerId = req.user!.id;
  const bookings = await prisma.booking.findMany({
    where: { customerId },
    include: { table: { include: { branch: { select: { name: true } } } } },
    orderBy: { date: 'desc' },
  });
  res.json(bookings);
});

router.post('/bookings', async (req: Request, res: Response) => {
  const customerId = req.user!.id;
  const { tableId, guestCount, date } = req.body as {
    tableId?: number;
    guestCount?: number;
    date?: string;
  };

  if (!tableId || !guestCount || !date) {
    res.status(400).json({ error: 'tableId, guestCount and date are required.' });
    return;
  }

  const table = (await prisma.table.findUnique({ where: { id: tableId } })) as any;
  if (!table || table.status !== 'AVAILABLE') {
    res.status(400).json({ error: 'Table is not available.' });
    return;
  }

  const existingBooking = await prisma.booking.findFirst({
    where: {
      tableId,
      date: new Date(date),
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
  });

  if (existingBooking) {
    res.status(400).json({ error: 'This table is already reserved for the selected time. Please choose another table.' });
    return;
  }

  const booking = await prisma.booking.create({
    data: {
      customerId,
      tableId,
      guestCount,
      date: new Date(date),
    },
    include: { table: { include: { branch: { select: { name: true } } } } },
  });

  await prisma.table.update({
    where: { id: tableId },
    data: { status: 'RESERVED' as any },
  });

  res.status(201).json(booking);
});

router.delete('/bookings/:id', async (req: Request, res: Response) => {
  const customerId = req.user!.id;
  const id = Number(req.params.id);
  const booking = await prisma.booking.findUnique({ where: { id }, include: { table: true } }) as any;

  if (!booking || booking.customerId !== customerId) {
    res.status(403).json({ error: 'Booking not found.' });
    return;
  }

  await prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } });

  if (booking.table?.status === 'RESERVED') {
    await prisma.table.update({ where: { id: booking.tableId }, data: { status: 'AVAILABLE' as any } });
  }

  res.json({ message: 'Booking cancelled.' });
});

router.get('/orders', async (req: Request, res: Response) => {
  const customerId = req.user!.id;
  const orders = await prisma.order.findMany({
    where: { customerId },
    include: {
      items: { include: { menuItem: true } },
      branch: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(orders);
});

router.post('/orders', async (req: Request, res: Response) => {
  const customerId = req.user!.id;
  const { bookingId, items } = req.body as {
    bookingId?: number;
    items?: { menuItemId: number; quantity: number }[];
  };

  if (!bookingId || !items || items.length === 0) {
    res.status(400).json({ error: 'bookingId and items are required.' });
    return;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { table: true },
  });

  if (!booking || booking.customerId !== customerId) {
    res.status(403).json({ error: 'Booking not found.' });
    return;
  }

  const branchId = booking.table.branchId;
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((item) => item.menuItemId) }, branchId },
    select: { id: true, price: true },
  });

  if (menuItems.length !== items.length) {
    res.status(400).json({ error: 'One or more menu items are invalid for this branch.' });
    return;
  }

  const priceMap = Object.fromEntries(menuItems.map((item: { id: number; price: number }) => [item.id, item.price]));
  const total = items.reduce((sum, item) => sum + (priceMap[item.menuItemId] ?? 0) * item.quantity, 0);

  const order = await prisma.order.create({
    data: {
      customerId,
      bookingId,
      branchId,
      total,
      items: {
        create: items.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          unitPrice: priceMap[item.menuItemId] ?? 0,
        })),
      },
    },
    include: { items: { include: { menuItem: true } } },
  });

  res.status(201).json(order);
});

router.post('/orders/:id/pay', async (req: Request, res: Response) => {
  try {
    const customerId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid order id.' });
      return;
    }

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.customerId !== customerId) {
      res.status(403).json({ error: 'Order not found or access denied.' });
      return;
    }

    const updated = await prisma.order.update({ where: { id }, data: { paymentStatus: 'PAID' } });
    res.json(updated);
  } catch (error) {
    console.error('[Customer PAY] error', error);
    res.status(500).json({ error: 'Failed to process payment.' });
  }
});

router.get('/receipt/:orderId', async (req: Request, res: Response) => {
  try {
    const customerId = req.user!.id;
    const orderId = Number(req.params.orderId);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'Invalid order id.' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuItem: true } }, customer: true, branch: true },
    }) as any;

    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    if (order.customerId !== customerId) {
      res.status(403).json({ error: 'Unauthorized access to this receipt.' });
      return;
    }

    if (order.paymentStatus !== 'PAID') {
      res.status(400).json({ error: 'Receipt unavailable until payment is completed.' });
      return;
    }

    const receiptNumber = `STEAKZ-${order.id}-${Math.floor(new Date(order.createdAt).getTime() / 1000)}`;

    const items = order.items.map((it: any) => ({
      name: it.menuItem?.name ?? 'Item',
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.unitPrice * it.quantity,
    }));

    const receipt = {
      restaurantName: 'Steakz',
      receiptNumber,
      orderId: order.id,
      customerName: order.customer?.name ?? 'Guest',
      branchName: order.branch?.name ?? null,
      dateTime: new Date(order.createdAt).toISOString(),
      items,
      totalAmount: order.total,
      paymentStatus: 'Paid',
      thankYou: 'Thank you for dining with us at Steakz!',
    };

    res.json(receipt);
  } catch (error) {
    console.error('[Customer RECEIPT] error', error);
    res.status(500).json({ error: 'Failed to fetch receipt.' });
  }
});

export default router;
