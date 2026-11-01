import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';

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
      tables: { where: { isAvailable: true } },
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
  const date = req.query.date as string;
  if (!id || !date) {
    res.status(400).json({ error: 'tableId and date are required.' });
    return;
  }

  const exists = await prisma.booking.findFirst({
    where: {
      tableId: id,
      date: new Date(date),
      status: { in: ['PENDING', 'CONFIRMED'] },
      table: { branch: { isActive: true } },
    },
  });

  res.json({ available: !Boolean(exists) });
});

export default router;
