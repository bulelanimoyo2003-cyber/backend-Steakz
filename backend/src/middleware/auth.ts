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

export function verifyToken(req: Request, res: Response, next: NextFunction): void {
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

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: number;
      role: string;
      branchId: number | null;
    };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
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

export function requireBranch(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.branchId) {
    res.status(403).json({ error: 'No branch assigned to this account.' });
    return;
  }
  next();
}

export async function requireManagerBranch(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const account = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { role: true, isActive: true },
  });
  if (!account || !account.isActive || account.role !== req.user.role) {
    res.status(403).json({ error: 'This account is inactive or its role has changed.' });
    return;
  }

  const rawBranchId = req.get('X-Branch-Id') ?? req.query.branchId;
  const branchId = rawBranchId === undefined ? req.user.branchId : Number(rawBranchId);
  if (!Number.isInteger(branchId) || !branchId || branchId <= 0) {
    res.status(400).json({ error: 'A valid branch selection is required.' });
    return;
  }

  if (req.user.role === 'BRANCH_MANAGER') {
    const assignment = await prisma.branchManagerAssignment.findUnique({
      where: { userId_branchId: { userId: req.user.id, branchId } },
      select: { branchId: true },
    });
    if (!assignment) {
      res.status(403).json({ error: 'You are not assigned to this branch.' });
      return;
    }
  } else if (req.user.role === 'ADMIN' || req.user.role === 'HQ_MANAGER') {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) {
      res.status(404).json({ error: 'Branch not found.' });
      return;
    }
  } else {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  req.managerBranchId = branchId;
  req.user.branchId = branchId;
  next();
}
