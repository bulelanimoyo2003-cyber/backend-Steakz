import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { getBookingOverlapRange } from '../lib/dineInBooking.js';

const router = Router();

router.get('/branches', async (_req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
  res.json(branches);
});

router.get('/branches/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const branch = await prisma.branch.findUnique({
    where: { id },
    include: {
      // Inactive locations remain available to staff for historical work, not to customers.
      tables: { where: { isAvailable: true, status: 'AVAILABLE' } },
      menuItems: { where: { isAvailable: true } },
    },
  });
  if (!branch || !branch.isActive) {
    res.status(404).json({ error: 'Branch not found.' });
    return;
  }
  res.json(branch);
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
  if (!table.isAvailable || table.status !== 'AVAILABLE') {
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
