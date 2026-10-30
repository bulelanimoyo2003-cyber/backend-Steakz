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
      assignedDriver: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(orders);
});

router.post('/orders', async (req: Request, res: Response) => {
  const customerId = req.user!.id;
  const { bookingId: requestedBookingId, branchId: requestedBranchId, items, orderType: requestedOrderType } = req.body as {
    bookingId?: number;
    items?: { menuItemId: number; quantity: number }[];
    branchId?: number;
    orderType?: string;
    recipientName?: string;
    recipientPhone?: string;
    deliveryAddress?: string;
    deliveryInstructions?: string;
  };
  const { recipientName, recipientPhone, deliveryAddress, deliveryInstructions } = req.body as {
    recipientName?: string;
    recipientPhone?: string;
    deliveryAddress?: string;
    deliveryInstructions?: string;
  };

  const orderTypes = ['DINE_IN', 'COLLECTION', 'DELIVERY'] as const;
  if (requestedOrderType !== undefined && !orderTypes.some((type) => type === requestedOrderType)) {
    res.status(400).json({ error: 'orderType must be DINE_IN, COLLECTION, or DELIVERY.' });
    return;
  }
  const orderType = requestedOrderType as (typeof orderTypes)[number] | undefined ?? 'DINE_IN';

  if (!Array.isArray(items) || items.length === 0 || items.length > 50
    || items.some((item) => !item || !Number.isInteger(item.menuItemId) || item.menuItemId <= 0
      || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 50)) {
    res.status(400).json({ error: 'Provide between 1 and 50 valid menu items with quantities from 1 to 50.' });
    return;
  }

  let bookingId: number | undefined;
  let resolvedBranchId: number;
  if (orderType === 'DINE_IN') {
    if (!Number.isInteger(requestedBookingId) || !requestedBookingId || requestedBookingId <= 0) {
      res.status(400).json({ error: 'bookingId is required for dine-in orders.' });
      return;
    }
    const booking = await prisma.booking.findUnique({
      where: { id: requestedBookingId },
      include: { table: true },
    });
    if (!booking || booking.customerId !== customerId) {
      res.status(403).json({ error: 'Booking not found.' });
      return;
    }
    bookingId = requestedBookingId;
    resolvedBranchId = booking.table.branchId;
  } else {
    if (!Number.isInteger(requestedBranchId) || !requestedBranchId || requestedBranchId <= 0) {
      res.status(400).json({ error: 'A valid branchId is required for collection and delivery orders.' });
      return;
    }
    const branch = await prisma.branch.findUnique({ where: { id: requestedBranchId } });
    if (!branch || !branch.isActive) {
      res.status(400).json({ error: 'The selected branch is unavailable.' });
      return;
    }
    resolvedBranchId = branch.id;
  }

  let deliveryDetails: {
    recipientName: string;
    recipientPhone: string;
    deliveryAddress: string;
    deliveryInstructions: string | null;
  } | undefined;
  if (orderType === 'DELIVERY') {
    const name = typeof recipientName === 'string' ? recipientName.trim() : '';
    const phone = typeof recipientPhone === 'string' ? recipientPhone.trim() : '';
    const address = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
    const instructions = typeof deliveryInstructions === 'string' ? deliveryInstructions.trim() : '';
    if (!name || name.length > 120 || !phone || phone.length > 30
      || !/^\+?[0-9\s().-]{7,30}$/.test(phone)
      || !address || address.length > 500
      || (deliveryInstructions !== undefined && deliveryInstructions !== null && typeof deliveryInstructions !== 'string')
      || instructions.length > 500) {
      res.status(400).json({
        error: 'Delivery requires a recipient name, valid phone number, and address. Instructions may be up to 500 characters.',
      });
      return;
    }
    deliveryDetails = {
      recipientName: name,
      recipientPhone: phone,
      deliveryAddress: address,
      deliveryInstructions: instructions || null,
    };
  }

  const menuItems = await prisma.menuItem.findMany({
    where: {
      id: { in: items.map((item) => item.menuItemId) },
      branchId: resolvedBranchId,
      isAvailable: true,
    },
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
      bookingId: orderType === 'DINE_IN' ? bookingId : undefined,
      branchId: resolvedBranchId,
      orderType,
      ...deliveryDetails,
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

function buildReceiptNumber(order: { id: number; createdAt: Date }) {
  return `STEAKZ-${order.id}-${Math.floor(order.createdAt.getTime() / 1000)}`;
}

router.get('/receipts', async (req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.user!.id, paymentStatus: 'PAID' },
    include: { branch: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  res.json(orders.map((order) => ({
    orderId: order.id,
    receiptNumber: buildReceiptNumber(order),
    branchName: order.branch.name,
    dateTime: order.createdAt.toISOString(),
    totalAmount: order.total,
    paymentStatus: order.paymentStatus,
  })));
});

router.get('/receipt/:orderId', async (req: Request, res: Response) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: 'Invalid order id.' });
    return;
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: req.user!.id, paymentStatus: 'PAID' },
    include: {
      items: { include: { menuItem: true } },
      customer: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });

  if (!order) {
    res.status(404).json({ error: 'Receipt not found.' });
    return;
  }

  res.json({
    restaurantName: 'Steakz Restaurant',
    receiptNumber: buildReceiptNumber(order),
    orderId: order.id,
    customerName: order.customer?.name ?? 'Guest',
    branchName: order.branch.name,
    dateTime: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      name: item.menuItem.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.unitPrice * item.quantity,
    })),
    totalAmount: order.total,
    paymentStatus: order.paymentStatus,
    cashierConfirmed: true,
    cashierConfirmedAt: null,
    thankYou: 'Thank you for dining with us at Steakz!',
  });
});

export default router;
