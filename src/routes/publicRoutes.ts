import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { getBookingOverlapRange } from '../lib/dineInBooking.js';
import { canReserveTable } from '../lib/bookingValidation.js';

const router = Router();

router.get('/branches', async (_req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      address: true,
      designatedDeliveryDriver: {
        select: { role: true, branchId: true, isActive: true },
      },
    },
    orderBy: { id: 'asc' },
  });
  res.json(branches.map(({ designatedDeliveryDriver, ...branch }) => ({
    ...branch,
    deliveryAvailable: Boolean(designatedDeliveryDriver?.isActive
      && designatedDeliveryDriver.role === 'DELIVERY_DRIVER'
      && designatedDeliveryDriver.branchId === branch.id),
  })));
});

router.get('/branches/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid branch ID.' });
    return;
  }

  const branch = await prisma.branch.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      tables: { where: { isAvailable: true, status: 'AVAILABLE' } },
      menuItems: { where: { isAvailable: true } },
      designatedDeliveryDriver: {
        select: { role: true, branchId: true, isActive: true },
      },
    },
  });
  if (!branch || !branch.isActive) {
    res.status(404).json({ error: 'This location is no longer active. Please select an active location.' });
    return;
  }
  const { designatedDeliveryDriver, ...publicBranch } = branch;
  res.json({
    ...publicBranch,
    deliveryAvailable: Boolean(designatedDeliveryDriver?.isActive
      && designatedDeliveryDriver.role === 'DELIVERY_DRIVER'
      && designatedDeliveryDriver.branchId === branch.id),
  });
});

router.get('/tables/:id/availability', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const dateValue = req.query.date;
  if (!Number.isInteger(id) || id <= 0 || typeof dateValue !== 'string' || !dateValue.trim()) {
    res.status(400).json({ error: 'tableId and date are required.' });
    return;
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    res.status(400).json({ error: 'A valid reservation date and time is required.' });
    return;
  }

  const table = await prisma.table.findUnique({
    where: { id },
    include: { branch: { select: { isActive: true } } },
  });
  if (!table || !table.branch.isActive) {
    res.status(404).json({ error: 'This location is no longer active. Please select an active location.' });
    return;
  }
  if (!canReserveTable(table)) {
    res.json({ available: false });
    return;
  }

  const overlapRange = getBookingOverlapRange(date);
  const exists = await prisma.booking.findFirst({
    where: {
      tableId: id,
      date: { gt: overlapRange.startsAfter, lt: overlapRange.startsBefore },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
  });

  res.json({ available: !Boolean(exists) });
});

export default router;
