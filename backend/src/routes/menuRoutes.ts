import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireBranch, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/:branchId', async (req: Request, res: Response) => {
  const branchId = Number(req.params.branchId);
  if (!branchId) {
    res.status(400).json({ error: 'Invalid branch ID.' });
    return;
  }
  const items = await prisma.menuItem.findMany({
    where: { branchId, isAvailable: true, branch: { isActive: true } },
    orderBy: { category: 'asc' },
  });
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
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item || item.branchId !== branchId) {
    res.status(403).json({ error: 'Item not found in your branch.' });
    return;
  }
  const updated = await prisma.menuItem.update({ where: { id }, data: req.body });
  res.json(updated);
});

export default router;
