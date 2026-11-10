import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole, requireManagerBranch } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['BRANCH_MANAGER']));

router.get('/branches', async (req: Request, res: Response) => {
  const assignments = await prisma.branchManagerAssignment.findMany({
    where: { userId: req.user!.id, branch: { isActive: true } },
    include: { branch: { select: { id: true, name: true, address: true, isActive: true } } },
    orderBy: { branchId: 'asc' },
  });
  res.json(assignments.map((assignment) => assignment.branch));
});

router.use(requireManagerBranch);

router.get('/overview', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { _count: { select: { orders: true, users: true, tables: true } } },
  });
  if (!branch) {
    res.status(404).json({ error: 'Branch not found.' });
    return;
  }
  res.set('Cache-Control', 'no-store').json(branch);
});

router.get('/orders', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const orders = await prisma.order.findMany({
    where: { branchId },
    include: {
      items: { include: { menuItem: true } },
      customer: { select: { name: true } },
      assignedDriver: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.set('Cache-Control', 'no-store').json(orders);
});

router.get('/staff', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const staff = await prisma.user.findMany({
    where: {
      role: { in: ['CHEF', 'CASHIER', 'BRANCH_MANAGER', 'DELIVERY_DRIVER'] },
      OR: [
        { branchId },
        { managedBranches: { some: { branchId } } },
      ],
    },
    select: { id: true, name: true, role: true, salary: true, isActive: true, branchId: true, branch: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });
  res.json(staff);
});

router.post('/staff/drivers', async (req: Request, res: Response) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedName || normalizedName.length > 120 || !normalizedEmail
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Provide a name, valid email, and password with at least 8 characters.' });
    return;
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          name: normalizedName,
          email: normalizedEmail,
          password: await bcrypt.hash(password, 10),
          role: 'DELIVERY_DRIVER',
          branchId: req.managerBranchId!,
        },
        select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true },
      });
      const designation = await transaction.branch.updateMany({
        where: { id: req.managerBranchId!, designatedDeliveryDriverId: null },
        data: { designatedDeliveryDriverId: user.id },
      });
      return { user, isDesignated: designation.count === 1 };
    });
    res.status(201).json({ ...result.user, isDesignated: result.isDesignated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'Email already in use.' });
      return;
    }
    console.error('[Branch manager create driver] Unexpected error:', error);
    res.status(500).json({ error: 'Unable to create delivery driver.' });
  }
});

router.get('/bookings', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const bookings = await prisma.booking.findMany({
    where: { table: { branchId } },
    include: {
      customer: { select: { name: true } },
      table: { select: { tableNumber: true, branch: { select: { id: true, name: true } } } },
    },
    orderBy: { date: 'asc' },
  });
  res.json(bookings);
});

router.patch('/bookings/:id/status', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const id = Number(req.params.id);
  const { status } = req.body as { status?: string };

  if (!status) {
    res.status(400).json({ error: 'status is required.' });
    return;
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { table: true },
  }) as any;

  if (!booking || booking.table.branchId !== branchId) {
    res.status(403).json({ error: 'Booking not found in your branch.' });
    return;
  }

  const data: any = { status: status as any };
  if (status === 'CONFIRMED') {
    data.table = { update: { status: 'OCCUPIED' as any } };
  }
  if (status === 'CANCELLED' && booking.table?.status !== 'CLEANING') {
    data.table = { update: { status: 'AVAILABLE' as any } };
  }
  if (status === 'COMPLETED') {
    data.table = { update: { status: 'CLEANING' as any } };
  }

  const updated = await prisma.booking.update({ where: { id }, data });

  res.json(updated);
});

router.get('/tables', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const tables = await prisma.table.findMany({
    where: { branchId },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { tableNumber: 'asc' },
  });
  res.json(tables);
});

router.patch('/tables/:id/status', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const id = Number(req.params.id);
  const { status } = req.body as { status?: string };

  if (!status) {
    res.status(400).json({ error: 'status is required.' });
    return;
  }

  const table = await prisma.table.findUnique({ where: { id } });
  if (!table || table.branchId !== branchId) {
    res.status(403).json({ error: 'Table not found in your branch.' });
    return;
  }

  const updated = await prisma.table.update({ where: { id }, data: { status: status as any } as any });
  res.json(updated);
});

router.get('/sales', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const result = await prisma.order.aggregate({
    where: { branchId, status: { in: ['DONE', 'DELIVERED'] } },
    _sum: { total: true },
    _count: { id: true },
  });
  res.set('Cache-Control', 'no-store').json({ totalSales: result._sum.total ?? 0, orderCount: result._count.id });
});

router.get('/menu', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const items = await prisma.menuItem.findMany({ where: { branchId }, orderBy: { category: 'asc' } });
  res.json(items);
});

router.post('/menu', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
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

router.patch('/menu/:id', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
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
    res.status(403).json({ error: 'Menu item not found in your branch.' });
    return;
  }
  const updated = await prisma.menuItem.findFirst({ where: { id, branchId } });
  if (!updated) {
    res.status(404).json({ error: 'Menu item not found.' });
    return;
  }
  res.json(updated);
});

router.delete('/menu/:id', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const id = Number(req.params.id);
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item || item.branchId !== branchId) {
    res.status(403).json({ error: 'Menu item not found in your branch.' });
    return;
  }
  await prisma.menuItem.delete({ where: { id } });
  res.json({ message: 'Menu item deleted.' });
});

router.patch('/staff/:id/salary', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const id = Number(req.params.id);
  const { salary } = req.body as { salary?: number };

  if (salary === undefined) {
    res.status(400).json({ error: 'salary is required.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, branchId: true } });
  const managerAssignment = user?.role === 'BRANCH_MANAGER'
    ? await prisma.branchManagerAssignment.findUnique({ where: { userId_branchId: { userId: id, branchId } } })
    : null;
  if (!user || (user.branchId !== branchId && !managerAssignment)) {
    res.status(403).json({ error: 'Staff member not found in your branch.' });
    return;
  }

  const updated = await prisma.user.update({ where: { id }, data: { salary } });
  res.json(updated);
});

router.patch('/staff/:id/status', async (req: Request, res: Response) => {
  const branchId = req.managerBranchId!;
  const id = Number(req.params.id);
  const { isActive } = req.body as { isActive?: boolean };

  if (isActive === undefined) {
    res.status(400).json({ error: 'isActive is required.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, branchId: true } });
  const managerAssignment = user?.role === 'BRANCH_MANAGER'
    ? await prisma.branchManagerAssignment.findUnique({ where: { userId_branchId: { userId: id, branchId } } })
    : null;
  if (!user || (user.branchId !== branchId && !managerAssignment)) {
    res.status(403).json({ error: 'Staff member not found in your branch.' });
    return;
  }

  const updated = await prisma.user.update({ where: { id }, data: { isActive } });
  res.json(updated);
});

export default router;
