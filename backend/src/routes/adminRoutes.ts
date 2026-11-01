import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['ADMIN']));

router.post('/branches', async (req: Request, res: Response) => {
  const { name, address, phone } = req.body as {
    name?: string;
    address?: string;
    phone?: string;
  };

  if (!name || !address) {
    res.status(400).json({ error: 'name and address are required.' });
    return;
  }

  try {
    const branch = await prisma.branch.create({ data: { name: name.trim(), address: address.trim(), phone: phone?.trim() } });
    res.status(201).json(branch);
  } catch {
    res.status(409).json({ error: 'Branch name already exists.' });
  }
});

router.get('/branches', async (_req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({ orderBy: { id: 'asc' } });
  res.json(branches);
});

router.post('/users', async (req: Request, res: Response) => {
  const { name, email, password, role, branchId, salary } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    branchId?: number;
    salary?: number;
  };

  if (!name || !email || !password || !role) {
    res.status(400).json({ error: 'name, email, password and role are required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const hashed = await bcrypt.hash(password, 10);
  const normalizedRole = role.trim();

  const requiresBranch = ['BRANCH_MANAGER', 'CHEF', 'CASHIER', 'DELIVERY_DRIVER'] as const;
  if (requiresBranch.includes(normalizedRole as any) && !branchId) {
    res.status(400).json({ error: 'branchId is required for staff roles.' });
    return;
  }

  try {
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: hashed,
        role: normalizedRole as any,
        branchId: branchId ?? null,
        salary: salary ?? null,
      },
    });
    res.status(201).json({ message: 'User created.', userId: user.id });
  } catch {
    res.status(409).json({ error: 'Email already in use.' });
  }
});

router.get('/users', async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      branchId: true,
      salary: true,
      branch: { select: { name: true } },
    },
    orderBy: { id: 'asc' },
  });
  res.json(users);
});

router.patch('/users/:id/role', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { role, branchId } = req.body as { role?: string; branchId?: number };

  if (!role) {
    res.status(400).json({ error: 'role is required.' });
    return;
  }

  const normalizedRole = role.trim();
  const requiresBranch = ['BRANCH_MANAGER', 'CHEF', 'CASHIER', 'DELIVERY_DRIVER'] as const;
  if (requiresBranch.includes(normalizedRole as any) && !branchId) {
    res.status(400).json({ error: 'branchId is required for staff roles.' });
    return;
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { role: normalizedRole as any, branchId: branchId ?? null },
    });
    res.json({ message: 'Role updated.', user });
  } catch {
    res.status(404).json({ error: 'User not found.' });
  }
});

router.patch('/users/:id/disable', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    res.json({ message: 'User disabled.' });
  } catch {
    res.status(404).json({ error: 'User not found.' });
  }
});

router.patch('/users/:id/enable', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.user.update({ where: { id }, data: { isActive: true } });
    res.json({ message: 'User enabled.' });
  } catch {
    res.status(404).json({ error: 'User not found.' });
  }
});

router.delete('/users/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.user.delete({ where: { id } });
    res.json({ message: 'User deleted.' });
  } catch {
    res.status(404).json({ error: 'User not found.' });
  }
});

export default router;
