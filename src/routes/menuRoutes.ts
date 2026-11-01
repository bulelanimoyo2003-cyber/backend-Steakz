import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireBranch, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/:branchId', async (req: Request, res: Response) => {
  const branchId = Number(req.params.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    res.status(400).json({ error: 'Invalid branch ID.' });
    return;
  }

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { isActive: true },
  });
  if (!branch || !branch.isActive) {
    res.status(404).json({ error: 'This location is no longer active. Please select an active location.' });
    return;
  }

  const items = await prisma.menuItem.findMany({ where: { branchId, isAvailable: true }, orderBy: { category: 'asc' } });
  res.json(items);
});

router.post('/', verifyToken, requireRole(['BRANCH_MANAGER', 'ADMIN']), requireBranch, async (req: Request, res: Response) => {
  const branchId = req.user!.branchId!;
  const { name, description, price, category } = req.body as {
    name?: string;
    description?: string;
    price?: number;
    category?: string;
  };

  if (!name || !price || !category) {
    res.status(400).json({ error: 'name, price and category are required.' });
    return;
  }

  const item = await prisma.menuItem.create({
    data: {
      name: name.trim(),
      description: description?.trim() ?? null,
      price,
      category: category.trim(),
      branchId,
    },
  });
  res.status(201).json(item);
});

router.patch('/:id', verifyToken, requireRole(['BRANCH_MANAGER', 'ADMIN']), requireBranch, async (req: Request, res: Response) => {
  const branchId = req.user!.branchId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid menu item id.' });
    return;
  }
  const { name, description, price, category, isAvailable } = req.body as {
    name?: unknown;
    description?: unknown;
    price?: unknown;
    category?: unknown;
    isAvailable?: unknown;
  };
  const data = {
    ...(typeof name === 'string' ? { name: name.trim() } : {}),
    ...(typeof description === 'string' || description === null ? { description } : {}),
    ...(typeof price === 'number' && Number.isFinite(price) && price >= 0 ? { price } : {}),
    ...(typeof category === 'string' ? { category: category.trim() } : {}),
    ...(typeof isAvailable === 'boolean' ? { isAvailable } : {}),
  };
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: 'Provide valid menu fields to update.' });
    return;
  }
  if ((name !== undefined && (typeof name !== 'string' || !name.trim()))
    || (description !== undefined && description !== null && typeof description !== 'string')
    || (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price < 0))
    || (category !== undefined && (typeof category !== 'string' || !category.trim()))
    || (isAvailable !== undefined && typeof isAvailable !== 'boolean')) {
    res.status(400).json({ error: 'One or more menu fields are invalid.' });
    return;
  }

  const updatedCount = await prisma.menuItem.updateMany({ where: { id, branchId }, data });
  if (updatedCount.count !== 1) {
    res.status(403).json({ error: 'Item not found in your branch.' });
    return;
  }
  const updated = await prisma.menuItem.findFirst({ where: { id, branchId } });
  if (!updated) {
    res.status(404).json({ error: 'Menu item not found.' });
    return;
  }
  res.json(updated);
});

export default router;
