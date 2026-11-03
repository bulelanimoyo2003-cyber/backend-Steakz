import { Router } from 'express';
import type { Request, Response } from 'express';
import { createRequire } from 'node:module';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { getJwtSecret, verifyToken } from '../middleware/auth.js';

const require = createRequire(import.meta.url);
const { Prisma } = require('../generated/prisma/index.js') as typeof import('../generated/prisma/index.js');
const router = Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

router.post('/register', async (req: Request, res: Response) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ error: 'name, email and password are required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const hashed = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: { name: name.trim(), email: normalizedEmail, password: hashed, role: 'CUSTOMER' },
    });
    res.status(201).json({ message: 'Registration successful.', userId: user.id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'Email already in use.' });
      return;
    }

    console.error('[Register] Unexpected error:', error);
    res.status(500).json({ error: 'Registration failed. Check server logs.' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid credentials or account is inactive.' });
      return;
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      res.status(401).json({ error: 'Invalid credentials or account is inactive.' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, branchId: user.branchId },
      getJwtSecret(),
      { expiresIn: JWT_EXPIRES_IN as unknown as jwt.SignOptions['expiresIn'] }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId,
      },
    });
  } catch (error) {
    console.error('[Auth] /login error:', error);
    // Ensure we always return JSON (avoid crashing)
    res.status(500).json({ error: 'Login failed due to server error.' });
  }
});

router.get('/test', (req: Request, res: Response) => {
  res.json({ status: 'auth route working' });
});

router.get('/me', verifyToken, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true },
  });
  res.json(user);
});

export default router; 
