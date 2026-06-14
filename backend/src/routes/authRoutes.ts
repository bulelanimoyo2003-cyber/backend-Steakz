import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type Secret } from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET: Secret = process.env.JWT_SECRET ?? 'dev-secret';
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

// OPTIONS preflight for login (explicitly return CORS headers if needed)
router.options('/login', (req: Request, res: Response) => {
  const origin = process.env.FRONTEND_URL ?? 'https://steak-frontend-dx21.onrender.com';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(204);
});

router.post('/login', async (req: Request, res: Response) => {
  console.log('[Auth] POST /login hit');
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      console.warn('[Auth] Missing email or password');
      res.status(400).json({ error: 'email and password are required.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

    if (!user || !user.isActive) {
      console.warn('[Auth] Invalid credentials or inactive account for', email);
      res.status(401).json({ error: 'Invalid credentials or account is inactive.' });
      return;
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.warn('[Auth] Password mismatch for', email);
      res.status(401).json({ error: 'Invalid credentials or account is inactive.' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, branchId: user.branchId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN as unknown as jwt.SignOptions['expiresIn'] }
    );

    console.log('[Auth] Login success for', email);
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

router.get('/me', verifyToken, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true },
  });
  res.json(user);
});

export default router;
