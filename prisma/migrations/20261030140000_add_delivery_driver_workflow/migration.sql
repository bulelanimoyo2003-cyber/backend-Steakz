ALTER TABLE "Order" ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'DINE_IN';
ALTER TABLE "Order" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "recipientName" TEXT;
ALTER TABLE "Order" ADD COLUMN "recipientPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryAddress" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryInstructions" TEXT;
ALTER TABLE "Order" ADD COLUMN "assignedDriverId" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "assignedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "pickedUpAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "deliveredAt" DATETIME;

CREATE INDEX "Order_assignedDriverId_deliveryStatus_idx" ON "Order"("assignedDriverId", "deliveryStatus");
CREATE INDEX "Order_branchId_orderType_deliveryStatus_idx" ON "Order"("branchId", "orderType", "deliveryStatus");
