ALTER TABLE "Branch"
  ADD COLUMN IF NOT EXISTS "designatedDeliveryDriverId" INTEGER;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Branch_designatedDeliveryDriverId_key"
  ON "Branch"("designatedDeliveryDriverId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Branch_designatedDeliveryDriverId_fkey'
  ) THEN
    ALTER TABLE "Branch"
      ADD CONSTRAINT "Branch_designatedDeliveryDriverId_fkey"
      FOREIGN KEY ("designatedDeliveryDriverId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Order_assignedDriverId_deliveryStatus_idx"
  ON "Order"("assignedDriverId", "deliveryStatus");

CREATE INDEX IF NOT EXISTS "Order_branchId_orderType_deliveryStatus_idx"
  ON "Order"("branchId", "orderType", "deliveryStatus");

WITH eligible AS (
  SELECT "branchId", MIN("id") AS "driverId"
  FROM "User"
  WHERE "role" = 'DELIVERY_DRIVER' AND "isActive" = true AND "branchId" IS NOT NULL
  GROUP BY "branchId"
  HAVING COUNT(*) = 1
)
UPDATE "Branch" AS branch
SET "designatedDeliveryDriverId" = eligible."driverId"
FROM eligible
WHERE branch."id" = eligible."branchId"
  AND branch."isActive" = true
  AND branch."designatedDeliveryDriverId" IS NULL;
