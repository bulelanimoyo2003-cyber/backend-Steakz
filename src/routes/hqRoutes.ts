import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['HQ_MANAGER', 'ADMIN']));

router.get('/overview', async (_req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    include: { _count: { select: { orders: true, users: true, tables: true } } },
    orderBy: { id: 'asc' },
  });
  res.json(branches);
});

router.get('/orders', async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { branch: { isActive: true } },
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
    where: {
      OR: [
        { role: 'HQ_MANAGER' },
        {
          role: { in: ['BRANCH_MANAGER', 'CHEF', 'CASHIER', 'DELIVERY_DRIVER'] },
          branch: { isActive: true },
        },
      ],
    },
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
  const [branches, sales] = await Promise.all([
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    }),
    prisma.order.groupBy({
      by: ['branchId'],
      _sum: { total: true },
      _count: { id: true },
      where: { status: { in: ['DONE', 'DELIVERED'] }, branch: { isActive: true } },
    }),
  ]);
  const salesByBranch = new Map(sales.map((sale) => [sale.branchId, sale]));
  const result = branches.map((branch) => {
    const sale = salesByBranch.get(branch.id);
    return {
      branchId: branch.id,
      branchName: branch.name,
      totalSales: sale?._sum.total ?? 0,
      orderCount: sale?._count.id ?? 0,
    };
  });
  res.json(result);
});

export default router;
