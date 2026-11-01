BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM "Branch" WHERE "name" IN (
    'Steakz City Centre',
    'Steakz Northside',
    'Steakz Southgate',
    'Steakz Uptown'
  )) <> 4 THEN
    RAISE EXCEPTION 'Expected exactly the four configured Steakz branches by name; no data was changed.';
  END IF;

  IF (SELECT count(*) FROM "User"
      WHERE "email" = 'steakz.city.centre.manager@steakz.com'
        AND "role" = 'BRANCH_MANAGER') <> 1 THEN
    RAISE EXCEPTION 'Expected the selected City Centre branch manager; no data was changed.';
  END IF;
END
$$;

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DELIVERY_DRIVER';

DO $$
BEGIN
  CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'COLLECTION', 'DELIVERY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "DeliveryStatus" AS ENUM ('ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "orderType" "OrderType" NOT NULL DEFAULT 'DINE_IN',
  ADD COLUMN IF NOT EXISTS "checkoutRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientName" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryInstructions" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryStatus" "DeliveryStatus",
  ADD COLUMN IF NOT EXISTS "assignedDriverId" INTEGER,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pickedUpAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Order_checkoutRequestId_key"
  ON "Order"("checkoutRequestId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_assignedDriverId_fkey'
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_assignedDriverId_fkey"
      FOREIGN KEY ("assignedDriverId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "BranchManagerAssignment" (
  "userId" INTEGER NOT NULL,
  "branchId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BranchManagerAssignment_pkey" PRIMARY KEY ("userId", "branchId"),
  CONSTRAINT "BranchManagerAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BranchManagerAssignment_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BranchManagerAssignment_branchId_idx"
  ON "BranchManagerAssignment"("branchId");

INSERT INTO "BranchManagerAssignment" ("userId", "branchId")
SELECT manager."id", manager."branchId"
FROM "User" manager
WHERE manager."role" = 'BRANCH_MANAGER'
  AND manager."branchId" IS NOT NULL
ON CONFLICT ("userId", "branchId") DO NOTHING;

UPDATE "Branch"
SET "isActive" = ("name" IN (
  'Steakz City Centre',
  'Steakz Northside',
  'Steakz Southgate',
  'Steakz Uptown'
));

INSERT INTO "BranchManagerAssignment" ("userId", "branchId")
SELECT manager."id", branch."id"
FROM "User" manager
CROSS JOIN "Branch" branch
WHERE manager."email" = 'steakz.city.centre.manager@steakz.com'
  AND manager."role" = 'BRANCH_MANAGER'
  AND branch."name" IN (
    'Steakz City Centre',
    'Steakz Northside',
    'Steakz Southgate',
    'Steakz Uptown'
  )
ON CONFLICT ("userId", "branchId") DO NOTHING;

COMMIT;
