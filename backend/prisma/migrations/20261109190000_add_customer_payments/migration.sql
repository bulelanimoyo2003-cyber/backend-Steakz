ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'STRIPE');

ALTER TABLE "Order"
  ADD COLUMN "paymentMethod" "PaymentMethod",
  ADD COLUMN "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EUR',
  ADD COLUMN "paymentAttemptId" TEXT,
  ADD COLUMN "paymentSessionId" TEXT,
  ADD COLUMN "paymentCheckoutUrl" TEXT,
  ADD COLUMN "paymentSessionExpiresAt" TIMESTAMP(3);

UPDATE "Order" SET "subtotal" = "total" WHERE "subtotal" = 0;

CREATE UNIQUE INDEX "Order_paymentSessionId_key" ON "Order"("paymentSessionId");

CREATE TABLE "PaymentEvent" (
  "id" SERIAL NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "orderId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PaymentEvent_providerEventId_key" ON "PaymentEvent"("providerEventId");
CREATE INDEX "PaymentEvent_orderId_createdAt_idx" ON "PaymentEvent"("orderId", "createdAt");
