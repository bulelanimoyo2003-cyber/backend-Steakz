import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole, requireBranch } from '../middleware/auth.js';
import {
  canAccessAssignedDelivery,
  canCompleteDelivery,
  canPickUpDelivery,
} from '../lib/deliveryWorkflow.js';

const router = Router();
router.use(verifyToken, requireRole(['DELIVERY_DRIVER']), requireBranch);
router.use(async (req: Request, res: Response, next) => {
  const account = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { role: true, branchId: true, isActive: true },
  });
  if (!account || !account.isActive || account.role !== 'DELIVERY_DRIVER'
    || account.branchId !== req.user!.branchId) {
    res.status(403).json({ error: 'This delivery driver account is inactive or has changed.' });
    return;
  }
  next();
});

const driverOrderSelect = {
  id: true,
  status: true,
  orderType: true,
  deliveryStatus: true,
  assignedDriverId: true,
  recipientName: true,
  recipientPhone: true,
  deliveryAddress: true,
  deliveryInstructions: true,
  assignedAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  branch: { select: { name: true, address: true } },
  assignedDriver: { select: { id: true, name: true } },
  items: { select: { quantity: true, menuItem: { select: { name: true } } } },
} as const;

router.get('/profile', async (req: Request, res: Response) => {
  const driver = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      name: true,
      email: true,
      branch: { select: { id: true, name: true, address: true } },
    },
  });
  if (!driver?.branch) {
    res.status(403).json({ error: 'This delivery driver has no assigned restaurant branch.' });
    return;
  }
  res.json(driver);
});

router.get('/orders', async (req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: {
      orderType: 'DELIVERY',
      assignedDriverId: req.user!.id,
      branchId: req.user!.branchId!,
    },
    select: driverOrderSelect,
    orderBy: [{ deliveryStatus: 'asc' }, { assignedAt: 'desc' }],
  });
  res.json(orders);
});

router.patch('/orders/:id/pickup', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid order id.' });
    return;
  }

  const visibleOrder = await prisma.order.findFirst({
    where: { id, assignedDriverId: req.user!.id, branchId: req.user!.branchId!, orderType: 'DELIVERY' },
  });
  if (!visibleOrder || !canAccessAssignedDelivery(req.user!, visibleOrder)) {
    res.status(404).json({ error: 'Assigned delivery not found.' });
    return;
  }
  if (visibleOrder.status === 'DONE' && visibleOrder.deliveryStatus === 'OUT_FOR_DELIVERY') {
    res.json(await prisma.order.findUnique({ where: { id }, select: driverOrderSelect }));
    return;
  }
  if (!canPickUpDelivery(visibleOrder)) {
    res.status(409).json({ error: 'Only assigned deliveries marked DONE by the kitchen can be picked up.' });
    return;
  }

  const updatedCount = await prisma.order.updateMany({
    where: {
      id,
      assignedDriverId: req.user!.id,
      branchId: req.user!.branchId!,
      orderType: 'DELIVERY',
      status: 'DONE',
      deliveryStatus: 'ASSIGNED',
    },
    data: { deliveryStatus: 'OUT_FOR_DELIVERY', pickedUpAt: new Date() },
  });
  if (updatedCount.count !== 1) {
    const currentOrder = await prisma.order.findFirst({
      where: { id, assignedDriverId: req.user!.id, branchId: req.user!.branchId!, orderType: 'DELIVERY' },
    });
    if (currentOrder?.status === 'DONE' && currentOrder.deliveryStatus === 'OUT_FOR_DELIVERY') {
      res.json(await prisma.order.findUnique({ where: { id }, select: driverOrderSelect }));
      return;
    }
    res.status(409).json({ error: 'Delivery status changed; reload before trying again.' });
    return;
  }

  res.json(await prisma.order.findUnique({ where: { id }, select: driverOrderSelect }));
});

router.patch('/orders/:id/delivered', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid order id.' });
    return;
  }

  const visibleOrder = await prisma.order.findFirst({
    where: { id, assignedDriverId: req.user!.id, branchId: req.user!.branchId!, orderType: 'DELIVERY' },
  });
  if (!visibleOrder || !canAccessAssignedDelivery(req.user!, visibleOrder)) {
    res.status(404).json({ error: 'Assigned delivery not found.' });
    return;
  }
  if (visibleOrder.deliveryStatus === 'DELIVERED') {
    res.json(await prisma.order.findUnique({ where: { id }, select: driverOrderSelect }));
    return;
  }
  if (!canCompleteDelivery(visibleOrder)) {
    res.status(409).json({ error: 'Only an order out for delivery can be marked delivered.' });
    return;
  }

  const updatedCount = await prisma.order.updateMany({
    where: {
      id,
      assignedDriverId: req.user!.id,
      branchId: req.user!.branchId!,
      orderType: 'DELIVERY',
      status: 'DONE',
      deliveryStatus: 'OUT_FOR_DELIVERY',
    },
    data: { deliveryStatus: 'DELIVERED', deliveredAt: new Date() },
  });
  if (updatedCount.count !== 1) {
    const currentOrder = await prisma.order.findFirst({
      where: { id, assignedDriverId: req.user!.id, branchId: req.user!.branchId!, orderType: 'DELIVERY' },
    });
    if (currentOrder?.deliveryStatus === 'DELIVERED') {
      res.json(await prisma.order.findUnique({ where: { id }, select: driverOrderSelect }));
      return;
    }
    res.status(409).json({ error: 'Delivery status changed; reload before trying again.' });
    return;
  }

  res.json(await prisma.order.findUnique({ where: { id }, select: driverOrderSelect }));
});

export default router;
