import { Router } from 'express';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { canReserveTable, validateBookingDetails } from '../lib/bookingValidation.js';
import { getDineInBookingWindow, isDineInBookingEligible } from '../lib/dineInBooking.js';
import { isSameCheckoutRequest, type CheckoutSnapshot } from '../lib/orderIdempotency.js';
import { calculateCheckoutAmounts, roundPrice } from '../lib/checkoutPricing.js';
import { getStripeClient } from '../lib/stripe.js';

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

router.get('/bookings/eligible', async (req: Request, res: Response) => {
  const branchId = Number(req.query.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    res.status(400).json({ error: 'A valid branchId is required.' });
    return;
  }

  const now = Date.now();
  const window = getDineInBookingWindow();
  const bookings = await prisma.booking.findMany({
    where: {
      customerId: req.user!.id,
      status: 'CONFIRMED',
      date: {
        gte: new Date(now - window.visitDurationMinutes * 60_000),
        lte: new Date(now + window.earlyWindowMinutes * 60_000),
      },
      table: { branchId, branch: { isActive: true } },
    },
    include: { table: { include: { branch: { select: { name: true } } } } },
    orderBy: { date: 'asc' },
  });
  res.json(bookings.filter((booking) => isDineInBookingEligible(booking, now, window)));
});

router.post('/bookings', async (req: Request, res: Response) => {
  const customerId = req.user!.id;
  const { tableId, guestCount, date } = req.body as {
    tableId?: number;
    guestCount?: number;
    date?: string;
  };

  const validationError = validateBookingDetails(tableId, guestCount, date);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const table = await prisma.table.findUnique({
    where: { id: tableId! },
    include: { branch: { select: { isActive: true } } },
  });
  if (table && !table.branch.isActive) {
    res.status(400).json({ error: 'This location is no longer active. Please select an active location.' });
    return;
  }
  if (!table || !canReserveTable(table)) {
    res.status(400).json({ error: 'Table is not available.' });
    return;
  }

  const capacityError = validateBookingDetails(tableId, guestCount, date, table.capacity);
  if (capacityError) {
    res.status(400).json({ error: capacityError });
    return;
  }

  const reservationDate = new Date(date ?? '');
  const existingBooking = await prisma.booking.findFirst({
    where: {
      tableId,
      date: reservationDate,
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
  });

  if (existingBooking) {
    res.status(400).json({ error: 'This table is already reserved for the selected time. Please choose another table.' });
    return;
  }

  const booking = await prisma.$transaction(async (transaction) => {
    const createdBooking = await transaction.booking.create({
      data: {
        customerId,
        tableId: table.id,
        guestCount: guestCount!,
        date: reservationDate,
      },
      include: { table: { include: { branch: { select: { name: true } } } } },
    });

    await transaction.table.update({
      where: { id: table.id },
      data: { status: 'RESERVED' },
    });

    return createdBooking;
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
  const updatedCount = await prisma.booking.updateMany({
    where: { id, customerId, status: { in: ['PENDING', 'CONFIRMED'] } },
    data: { status: 'CANCELLED' },
  });
  if (updatedCount.count !== 1) {
    res.status(409).json({ error: 'Reservation can no longer be cancelled.' });
    return;
  }

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

router.get('/orders/:id', async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: 'Invalid order id.' });
    return;
  }
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: req.user!.id },
    include: {
      items: { include: { menuItem: { select: { name: true } } } },
      branch: { select: { name: true } },
      assignedDriver: { select: { name: true } },
    },
  });
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  res.set('Cache-Control', 'no-store').json(order);
});

router.post('/orders', async (req: Request, res: Response) => {
  const customerId = req.user!.id;
  const checkoutRequestId = req.get('Idempotency-Key');
  if (!checkoutRequestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutRequestId)) {
    res.status(400).json({ error: 'A UUID Idempotency-Key is required to prevent duplicate orders.' });
    return;
  }
  const { bookingId: requestedBookingId, branchId: requestedBranchId, items, orderType: requestedOrderType, paymentMethod: requestedPaymentMethod } = req.body as {
    bookingId?: number;
    items?: { menuItemId: number; quantity: number }[];
    branchId?: number;
    orderType?: string;
    paymentMethod?: string;
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
  if (requestedPaymentMethod !== undefined && requestedPaymentMethod !== 'CASH' && requestedPaymentMethod !== 'STRIPE') {
    res.status(400).json({ error: 'paymentMethod must be CASH or STRIPE.' });
    return;
  }
  const paymentMethod = requestedPaymentMethod ?? 'CASH';
  if (paymentMethod === 'STRIPE' && !getStripeClient()) {
    res.status(503).json({ error: 'Online card payments are not configured. Choose cash at the cashier.' });
    return;
  }
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
      include: { table: { include: { branch: { select: { isActive: true } } } } },
    });
    if (!booking || booking.customerId !== customerId) {
      res.status(403).json({ error: 'Booking not found.' });
      return;
    }
    if (!Number.isInteger(requestedBranchId) || !requestedBranchId || requestedBranchId <= 0) {
      res.status(400).json({ error: 'A valid branchId is required for dine-in orders.' });
      return;
    }
    if (requestedBranchId !== booking.table.branchId) {
      res.status(400).json({ error: 'Dine-in orders must use the location assigned to the reservation.' });
      return;
    }
    if (!booking.table.branch.isActive) {
      res.status(400).json({ error: 'This location is no longer active. Please select an active location.' });
      return;
    }
    if (!isDineInBookingEligible(booking)) {
      res.status(409).json({ error: 'Dine-in orders require a confirmed booking within its dining window.' });
      return;
    }
    bookingId = requestedBookingId;
    resolvedBranchId = booking.table.branchId;
  } else {
    if (!Number.isInteger(requestedBranchId) || !requestedBranchId || requestedBranchId <= 0) {
      res.status(400).json({ error: 'A valid branchId is required for collection and delivery orders.' });
      return;
    }
    const branch = await prisma.branch.findUnique({
      where: { id: requestedBranchId },
      include: {
        designatedDeliveryDriver: {
          select: { id: true, role: true, branchId: true, isActive: true },
        },
      },
    });
    if (!branch || !branch.isActive) {
      res.status(400).json({ error: 'This location is no longer active. Please select an active location.' });
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

  const priceMap = Object.fromEntries(menuItems.map((item: { id: number; price: number }) => [
    item.id,
    roundPrice(item.price),
  ]));
  const amounts = calculateCheckoutAmounts(items.map((item) => ({
    ...item,
    price: priceMap[item.menuItemId] ?? 0,
  })), orderType);

  const requestedCheckout: CheckoutSnapshot = {
    customerId,
    branchId: resolvedBranchId,
    bookingId: orderType === 'DINE_IN' ? bookingId ?? null : null,
    orderType,
    paymentMethod,
    recipientName: deliveryDetails?.recipientName ?? null,
    recipientPhone: deliveryDetails?.recipientPhone ?? null,
    deliveryAddress: deliveryDetails?.deliveryAddress ?? null,
    deliveryInstructions: deliveryDetails?.deliveryInstructions ?? null,
    items: items.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      unitPrice: priceMap[item.menuItemId] ?? 0,
    })),
  };

  const findExistingCheckout = () => checkoutRequestId
    ? prisma.order.findUnique({
      where: { checkoutRequestId },
      include: {
        items: { include: { menuItem: true } },
        assignedDriver: { select: { id: true, name: true } },
      },
    })
    : null;

  const existingOrder = await findExistingCheckout();
  if (existingOrder) {
    if (existingOrder.customerId !== customerId) {
      res.status(409).json({ error: 'This checkout key has already been used.' });
      return;
    }

    if (!isSameCheckoutRequest(existingOrder, requestedCheckout)) {
      res.status(409).json({ error: 'This checkout key was already used for a different order.' });
      return;
    }

    res.status(200).json(existingOrder);
    return;
  }

  if (orderType === 'DELIVERY') {
    const designatedDriver = (await prisma.branch.findUnique({
      where: { id: resolvedBranchId },
      select: {
        isActive: true,
        designatedDeliveryDriver: {
          select: { id: true, role: true, branchId: true, isActive: true },
        },
      },
    }))?.designatedDeliveryDriver;
    if (!designatedDriver || !designatedDriver.isActive
      || designatedDriver.role !== 'DELIVERY_DRIVER'
      || designatedDriver.branchId !== resolvedBranchId) {
      res.status(409).json({
        error: 'Delivery is unavailable at this location because no eligible delivery driver is designated.',
      });
      return;
    }
  }

  try {
    const order = await prisma.$transaction(async (transaction) => {
      if (orderType === 'DINE_IN') {
        const currentBooking = await transaction.booking.findFirst({
          where: {
            id: bookingId,
            customerId,
            table: { branchId: resolvedBranchId, branch: { isActive: true } },
          },
          select: { status: true, date: true },
        });
        if (!currentBooking || !isDineInBookingEligible(currentBooking)) {
          throw new DineInBookingUnavailableError();
        }
      }

      const branch = orderType === 'DELIVERY'
        ? await transaction.branch.findUnique({
          where: { id: resolvedBranchId },
          select: {
            isActive: true,
            designatedDeliveryDriver: {
              select: { id: true, role: true, branchId: true, isActive: true },
            },
          },
        })
        : null;
      const driver = branch?.designatedDeliveryDriver;
      if (orderType === 'DELIVERY' && (!branch?.isActive || !driver || !driver.isActive
        || driver.role !== 'DELIVERY_DRIVER' || driver.branchId !== resolvedBranchId)) {
        throw new DeliveryUnavailableError();
      }

      return transaction.order.create({
        data: {
          customerId,
          bookingId: orderType === 'DINE_IN' ? bookingId : undefined,
          branchId: resolvedBranchId,
          orderType,
          paymentMethod,
          checkoutRequestId,
          ...(orderType === 'DELIVERY'
            ? {
              assignedDriverId: driver!.id,
              deliveryStatus: 'ASSIGNED' as const,
              assignedAt: new Date(),
            }
            : {}),
          ...deliveryDetails,
          subtotal: amounts.subtotal,
          discountTotal: amounts.discountTotal,
          deliveryFee: amounts.deliveryFee,
          currency: amounts.currency,
          total: amounts.total,
          items: {
            create: items.map((item) => ({
              menuItemId: item.menuItemId,
              quantity: item.quantity,
              unitPrice: priceMap[item.menuItemId] ?? 0,
            })),
          },
        },
        include: {
          items: { include: { menuItem: true } },
          assignedDriver: { select: { id: true, name: true } },
        },
      });
    });

    res.status(201).json(order);
  } catch (error) {
    if (error instanceof DineInBookingUnavailableError) {
      res.status(409).json({ error: 'Dine-in orders require a confirmed booking within its dining window.' });
      return;
    }
    if (error instanceof DeliveryUnavailableError) {
      res.status(409).json({
        error: 'Delivery is unavailable at this location because no eligible delivery driver is designated.',
      });
      return;
    }
    if (checkoutRequestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrentOrder = await findExistingCheckout();
      if (concurrentOrder?.customerId === customerId
        && isSameCheckoutRequest(concurrentOrder, requestedCheckout)) {
        res.status(200).json(concurrentOrder);
        return;
      }
      if (concurrentOrder) {
        res.status(409).json({ error: 'This checkout key has already been used.' });
        return;
      }
    }
    throw error;
  }
});

class DeliveryUnavailableError extends Error {}
class DineInBookingUnavailableError extends Error {}

function buildReceiptNumber(order: { id: number; createdAt: Date }) {
  return `STEAKZ-${order.id}-${Math.floor(order.createdAt.getTime() / 1000)}`;
}

router.get('/receipts', async (req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.user!.id, paymentStatus: 'PAID' },
    include: {
      branch: { select: { name: true } },
      assignedDriver: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.set('Cache-Control', 'no-store').json(orders.map((order) => ({
    orderId: order.id,
    receiptNumber: buildReceiptNumber(order),
    branchName: order.branch.name,
    dateTime: order.createdAt.toISOString(),
    totalAmount: order.total,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    deliveryFee: order.deliveryFee,
    currency: order.currency,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    orderType: order.orderType,
    deliveryStatus: order.deliveryStatus,
    assignedDriverName: order.assignedDriver?.name ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
  })));
});

router.get('/receipt/:orderId', async (req: Request, res: Response) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: 'Invalid order id.' });
    return;
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: req.user!.id },
    include: {
      items: { include: { menuItem: true } },
      customer: { select: { name: true } },
      branch: { select: { name: true } },
      assignedDriver: { select: { name: true } },
    },
  });

  if (!order) {
    res.status(404).json({ error: 'Receipt not found.' });
    return;
  }
  if (order.paymentStatus !== 'PAID') {
    res.status(409).json({ error: 'A receipt is available after payment is confirmed.' });
    return;
  }

  res.set('Cache-Control', 'no-store').json({
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
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    deliveryFee: order.deliveryFee,
    currency: order.currency,
    totalAmount: order.total,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    orderType: order.orderType,
    deliveryStatus: order.deliveryStatus,
    assignedDriverName: order.assignedDriver?.name ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    cashierConfirmed: order.paymentStatus === 'PAID' && order.paymentMethod !== 'STRIPE',
    cashierConfirmedAt: order.paidAt?.toISOString() ?? null,
    thankYou: 'Thank you for dining with us at Steakz!',
  });
});

export default router;
