import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole, requireManagerBranch } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['ADMIN', 'HQ_MANAGER', 'BRANCH_MANAGER']), requireManagerBranch);

router.get('/drivers', async (req: Request, res: Response) => {
  const requestedBranchId = Number(req.query.branchId);
  let branchId: number;

  if (req.user!.role === 'BRANCH_MANAGER') {
    if (!req.managerBranchId || (req.query.branchId && requestedBranchId !== req.managerBranchId)) {
      res.status(403).json({ error: 'You can only view drivers for the selected assigned location.' });
      return;
    }
    branchId = req.managerBranchId;
  } else {
    if (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0) {
      res.status(400).json({ error: 'A valid branchId is required.' });
      return;
    }
    branchId = requestedBranchId;
  }

  const drivers = await prisma.user.findMany({
    where: { branchId, role: 'DELIVERY_DRIVER', isActive: true },
    select: { id: true, name: true, branchId: true },
    orderBy: { name: 'asc' },
  });
  res.json(drivers);
});

router.patch('/orders/:id/driver', (_req: Request, res: Response) => {
  res.status(409).json({
    error: 'Driver assignment is automatic and controlled by the branch designation.',
  });
});

export default router;
