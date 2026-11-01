import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole, requireManagerBranch } from '../middleware/auth.js';
import {
  canAssignDelivery,
  canManageDeliveryOrder,
  isEligibleDeliveryDriver,
} from '../lib/deliveryWorkflow.js';

const router = Router();
router.use(verifyToken, requireRole(['ADMIN', 'HQ_MANAGER', 'BRANCH_MANAGER']), requireManagerBranch);

router.get('/drivers', async (req: Request, res: Response) => {
  const requestedBranchId = Number(req.query.branchId);
  let branchId: number;

  if (req.user!.role === 'BRANCH_MANAGER') {
    if (!req.managerBranchId || (req.query.branchId && requestedBranchId !== req.managerBranchId)) {
      res.status(403).json({ error: 'You can only view drivers for the selected assigned location.' });
      return;
    }
    branchId = req.managerBranchId;
  } else {
    if (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0) {
      res.status(400).json({ error: 'A valid branchId is required.' });
      return;
    }
    branchId = requestedBranchId;
  }

  const drivers = await prisma.user.findMany({
    where: { branchId, role: 'DELIVERY_DRIVER', isActive: true },
    select: { id: true, name: true, branchId: true },
    orderBy: { name: 'asc' },
  });
  res.json(drivers);
});

router.patch('/orders/:id/driver', async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const driverId = Number(req.body?.driverId);
  if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(driverId) || driverId <= 0) {
    res.status(400).json({ error: 'A valid order id and driverId are required.' });
    return;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  const selectedBranchId = req.user!.role === 'BRANCH_MANAGER'
    ? req.managerBranchId
    : order.branchId;
  const actor = req.managerBranchId
    ? { ...req.user!, branchId: null, managedBranchIds: [req.managerBranchId] }
    : req.user!;
  if (!selectedBranchId || !canManageDeliveryOrder(actor, order) || order.branchId !== selectedBranchId) {
    res.status(403).json({ error: 'You cannot manage delivery orders for this branch.' });
    return;
  }
  if (!canAssignDelivery(order)) {
    res.status(409).json({ error: 'This delivery can no longer be assigned or reassigned.' });
    return;
  }

  const driver = await prisma.user.findUnique({
    where: { id: driverId },
    select: { id: true, role: true, branchId: true, isActive: true },
  });
  if (!driver || !isEligibleDeliveryDriver(driver, order)) {
    res.status(400).json({ error: 'Choose an active delivery driver from the order branch.' });
    return;
  }
  if (order.assignedDriverId === driver.id && order.deliveryStatus === 'ASSIGNED') {
    res.json(await prisma.order.findUnique({
      where: { id: orderId },
      include: { assignedDriver: { select: { id: true, name: true } } },
    }));
    return;
  }

  const updatedCount = await prisma.order.updateMany({
    where: {
      id: orderId,
      branchId: selectedBranchId,
      assignedDriverId: order.assignedDriverId,
      orderType: 'DELIVERY',
      status: { notIn: ['CANCELLED', 'DELIVERED'] },
      OR: [{ deliveryStatus: null }, { deliveryStatus: 'ASSIGNED' }],
    },
    data: {
      assignedDriverId: driver.id,
      deliveryStatus: 'ASSIGNED',
      assignedAt: new Date(),
      pickedUpAt: null,
      deliveredAt: null,
    },
  });
  if (updatedCount.count !== 1) {
    res.status(409).json({ error: 'Delivery status changed; reload the order before assigning a driver.' });
    return;
  }

  const updated = await prisma.order.findUnique({
    where: { id: orderId },
    include: { assignedDriver: { select: { id: true, name: true } } },
  });
  res.json(updated);
});

export default router;
