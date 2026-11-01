ALTER TABLE "Order" ADD COLUMN "checkoutRequestId" TEXT;

CREATE UNIQUE INDEX "Order_checkoutRequestId_key" ON "Order"("checkoutRequestId");
