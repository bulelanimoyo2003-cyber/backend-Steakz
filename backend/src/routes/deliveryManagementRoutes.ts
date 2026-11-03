import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, requireRole, requireManagerBranch } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken, requireRole(['ADMIN', 'HQ_MANAGER', 'BRANCH_MANAGER']), requireManagerBranch);

router.get('/drivers', async (req: Request, res: Response) => {
  const drivers = await prisma.user.findMany({
    where: { branchId: req.managerBranchId!, role: 'DELIVERY_DRIVER', isActive: true },
    select: { id: true, name: true, branchId: true },
    orderBy: { name: 'asc' },
  });
  res.json(drivers);
});

router.patch('/branches/:branchId/designated-driver', async (req: Request, res: Response) => {
  const branchId = Number(req.params.branchId);
  const driverId = Number(req.body?.driverId);
  if (!Number.isInteger(branchId) || branchId <= 0
    || !Number.isInteger(driverId) || driverId <= 0) {
    res.status(400).json({ error: 'A valid branchId and driverId are required.' });
    return;
  }
  if (branchId !== req.managerBranchId) {
    res.status(403).json({ error: 'You can only designate a delivery driver for the selected branch.' });
    return;
  }
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: { id: true },
  });
  if (!branch) {
    res.status(404).json({ error: 'Active branch not found.' });
    return;
  }
  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: 'DELIVERY_DRIVER', branchId, isActive: true },
    select: { id: true },
  });
  if (!driver) {
    res.status(400).json({ error: 'Choose an active delivery driver assigned to this branch.' });
    return;
  }
  const result = await prisma.branch.updateMany({
    where: { id: branchId, isActive: true },
    data: { designatedDeliveryDriverId: driver.id },
  });
  if (result.count !== 1) {
    res.status(409).json({ error: 'Branch designation changed; reload before trying again.' });
    return;
  }
  res.json({ branchId, designatedDeliveryDriverId: driver.id });
});

router.patch('/orders/:id/driver', async (req: Request, res: Response) => {
  res.status(409).json({
    error: 'Order assignment is automatic. Update the designated driver for the selected branch instead.',
  });
});

export default router;
