import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { getOrderHistoryWhere } from '../lib/localDemoOrderHistory.js';

const router = Router();
router.use(verifyToken, requireRole(['HQ_MANAGER', 'ADMIN']));

router.get('/overview', async (_req: Request, res: Response) => {
  const orderHistoryWhere = await getOrderHistoryWhere();
  const branches = await prisma.branch.findMany({
    include: {
      _count: {
        select: {
          orders: { where: orderHistoryWhere },
          users: true,
          tables: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  res.json(branches);
});

router.get('/orders', async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: await getOrderHistoryWhere(),
    include: {
      branch: { select: { id: true, name: true } },
      items: { include: { menuItem: true } },
      customer: { select: { name: true } },
      assignedDriver: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(orders);
});

router.get('/staff', async (_req: Request, res: Response) => {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['BRANCH_MANAGER', 'CHEF', 'CASHIER', 'DELIVERY_DRIVER', 'HQ_MANAGER'] } },
    select: {
      id: true,
      name: true,
      role: true,
      salary: true,
      isActive: true,
      branch: { select: { name: true } },
    },
    orderBy: { id: 'asc' },
  });
  res.json(staff);
});

router.get('/sales', async (_req: Request, res: Response) => {
  const sales = await prisma.order.groupBy({
    by: ['branchId'],
    _sum: { total: true },
    _count: { id: true },
    where: {
      ...(await getOrderHistoryWhere()),
      status: { in: ['DONE', 'DELIVERED'] },
    },
  });

  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchMap = Object.fromEntries(branches.map((b: { id: number; name: string }) => [b.id, b.name]));

  const result = sales.map((s: { branchId: number; _sum: { total: number | null }; _count: { id: number } }) => ({
    branchId: s.branchId,
    branchName: branchMap[s.branchId] ?? 'Unknown',
    totalSales: s._sum.total ?? 0,
    orderCount: s._count.id,
  }));
  res.json(result);
});

export default router;
