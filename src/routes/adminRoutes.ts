import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import type { Role } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['ADMIN']));
const VALID_ROLES: readonly string[] = [
  'ADMIN',
  'HQ_MANAGER',
  'BRANCH_MANAGER',
  'CHEF',
  'CASHIER',
  'DELIVERY_DRIVER',
  'CUSTOMER',
];
const BRANCH_ROLES = ['BRANCH_MANAGER', 'CHEF', 'CASHIER', 'DELIVERY_DRIVER'];

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

  if (typeof name !== 'string' || !name.trim()
    || typeof email !== 'string' || !email.trim()
    || typeof password !== 'string' || !password
    || typeof role !== 'string' || !role.trim()) {
    res.status(400).json({ error: 'name, email, password and role are required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRole = role.trim();

  if (!VALID_ROLES.includes(normalizedRole)) {
    res.status(400).json({ error: 'Invalid user role.' });
    return;
  }
  if (normalizedRole === 'DELIVERY_DRIVER'
    && (name.trim().length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || password.length < 8)) {
    res.status(400).json({ error: 'Delivery drivers need a name (up to 120 characters), valid email, and password with at least 8 characters.' });
    return;
  }
  if (BRANCH_ROLES.includes(normalizedRole) && (!Number.isInteger(branchId) || !branchId || branchId <= 0)) {
    res.status(400).json({ error: 'branchId is required for staff roles.' });
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: hashed,
        role: normalizedRole as Role,
        branchId: branchId ?? null,
        salary: salary ?? null,
        ...(normalizedRole === 'BRANCH_MANAGER' && branchId
          ? { managedBranches: { create: { branchId } } }
          : {}),
      },
    });
    res.status(201).json({ message: 'User created.', userId: user.id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'Email already in use.' });
      return;
    }
    console.error('[Admin create user] Unexpected error:', error);
    res.status(500).json({ error: 'Unable to create user.' });
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

  if (typeof role !== 'string' || !role.trim()) {
    res.status(400).json({ error: 'role is required.' });
    return;
  }

  const normalizedRole = role.trim();
  if (!VALID_ROLES.includes(normalizedRole)) {
    res.status(400).json({ error: 'Invalid user role.' });
    return;
  }
  if (BRANCH_ROLES.includes(normalizedRole) && (!Number.isInteger(branchId) || !branchId || branchId <= 0)) {
    res.status(400).json({ error: 'branchId is required for staff roles.' });
    return;
  }

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id },
        data: { role: normalizedRole as Role, branchId: branchId ?? null },
      });
      if (normalizedRole === 'BRANCH_MANAGER' && branchId) {
        await transaction.branchManagerAssignment.upsert({
          where: { userId_branchId: { userId: id, branchId } },
          update: {},
          create: { userId: id, branchId },
        });
      } else {
        await transaction.branchManagerAssignment.deleteMany({ where: { userId: id } });
      }
      return updated;
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
