import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: string;
        branchId: number | null;
      };
      managerBranchId?: number;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

export async function verifyToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Malformed authorization header.' });
    return;
  }

  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  if (typeof decoded === 'string' || !Number.isSafeInteger(decoded.id) || Number(decoded.id) <= 0) {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  const account = await prisma.user.findUnique({
    where: { id: Number(decoded.id) },
    select: { id: true, role: true, branchId: true, isActive: true },
  });
  if (!account || !account.isActive) {
    res.status(401).json({ error: 'Account is inactive or no longer exists.' });
    return;
  }

  req.user = { id: account.id, role: account.role, branchId: account.branchId };
  next();
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    next();
  };
}

export async function requireBranch(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  const account = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { role: true, branchId: true, isActive: true },
  });
  if (!account || !account.isActive || account.role !== req.user.role || !account.branchId) {
    res.status(403).json({ error: 'This account has no active branch assignment.' });
    return;
  }

  req.user.branchId = account.branchId;
  next();
}

export async function requireManagerBranch(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role !== 'BRANCH_MANAGER') {
    next();
    return;
  }

  const rawBranchId = req.header('X-Branch-Id');
  const branchId = rawBranchId === undefined ? NaN : Number(rawBranchId);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    res.status(400).json({ error: 'Choose a specific assigned location before managing branch records.' });
    return;
  }

  const assignment = await prisma.branchManagerAssignment.findUnique({
    where: { userId_branchId: { userId: req.user.id, branchId } },
    select: { branchId: true },
  });
  if (!assignment) {
    res.status(403).json({ error: 'You are not assigned to manage this location.' });
    return;
  }

  req.managerBranchId = assignment.branchId;
  next();
}
