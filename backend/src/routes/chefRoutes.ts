import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole, requireBranch } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['CHEF']), requireBranch);

router.get('/orders', async (req: Request, res: Response) => {
  try {
    const branchId = req.user!.branchId!;
    const orders = await prisma.order.findMany({
      where: { branchId, status: { in: ['PENDING', 'PREPARING'] } },
      include: { items: { include: { menuItem: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(orders);
  } catch (error) {
    console.error('[CHEF ORDERS] error', error);
    res.status(500).json({ error: 'Failed to load chef orders.' });
  }
});

router.patch('/orders/:id/preparing', async (req: Request, res: Response) => {
  try {
    const branchId = req.user!.branchId!;
    const id = Number(req.params.id);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.branchId !== branchId) {
      res.status(403).json({ error: 'Order not found in your branch.' });
      return;
    }
    if (order.status !== 'PENDING') {
      res.status(409).json({ error: 'Only PENDING orders can move to PREPARING.' });
      return;
    }
    const updated = await prisma.order.updateMany({
      where: { id, branchId, status: 'PENDING' },
      data: { status: 'PREPARING' },
    });
    if (updated.count !== 1) {
      res.status(409).json({ error: 'Order status changed; reload before trying again.' });
      return;
    }
    res.json(await prisma.order.findUnique({ where: { id } }));
  } catch (error) {
    console.error('[CHEF PREPARING] error', error);
    res.status(500).json({ error: 'Failed to update order status to PREPARING.' });
  }
});

router.patch('/orders/:id/done', async (req: Request, res: Response) => {
  try {
    const branchId = req.user!.branchId!;
    const id = Number(req.params.id);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.branchId !== branchId) {
      res.status(403).json({ error: 'Order not found in your branch.' });
      return;
    }
    if (order.status !== 'PREPARING') {
      res.status(409).json({ error: 'Only PREPARING orders can move to DONE.' });
      return;
    }
    const updated = await prisma.order.updateMany({
      where: { id, branchId, status: 'PREPARING' },
      data: { status: 'DONE' },
    });
    if (updated.count !== 1) {
      res.status(409).json({ error: 'Order status changed; reload before trying again.' });
      return;
    }
    res.json(await prisma.order.findUnique({ where: { id } }));
  } catch (error) {
    console.error('[CHEF DONE] error', error);
    res.status(500).json({ error: 'Failed to update order status to DONE.' });
  }
});

router.get('/menu', async (req: Request, res: Response) => {
  const branchId = req.user!.branchId!;
  const items = await prisma.menuItem.findMany({ where: { branchId } });
  res.json(items);
});

router.delete('/menu/:id', async (req: Request, res: Response) => {
  const branchId = req.user!.branchId!;
  const id = Number(req.params.id);
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item || item.branchId !== branchId) {
    res.status(403).json({ error: 'Menu item not found in your branch.' });
    return;
  }
  await prisma.menuItem.delete({ where: { id } });
  res.json({ message: 'Menu item deleted.' });
});

export default router;
