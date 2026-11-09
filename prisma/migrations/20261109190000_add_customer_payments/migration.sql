CREATE TABLE "PaymentEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER,
    "bookingId" INTEGER,
    "branchId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderType" TEXT NOT NULL DEFAULT 'DINE_IN',
    "deliveryStatus" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paidAt" DATETIME,
    "paymentMethod" TEXT,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "discountTotal" REAL NOT NULL DEFAULT 0,
    "deliveryFee" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentAttemptId" TEXT,
    "paymentSessionId" TEXT,
    "paymentCheckoutUrl" TEXT,
    "paymentSessionExpiresAt" DATETIME,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "deliveryAddress" TEXT,
    "deliveryInstructions" TEXT,
    "assignedDriverId" INTEGER,
    "assignedAt" DATETIME,
    "pickedUpAt" DATETIME,
    "deliveredAt" DATETIME,
    "checkoutRequestId" TEXT,
    "total" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" (
    "id", "customerId", "bookingId", "branchId", "status", "orderType", "deliveryStatus",
    "paymentStatus", "subtotal", "total", "createdAt", "updatedAt", "assignedDriverId",
    "assignedAt", "pickedUpAt", "deliveredAt", "checkoutRequestId", "recipientName",
    "recipientPhone", "deliveryAddress", "deliveryInstructions"
)
SELECT
    "id", "customerId", "bookingId", "branchId", "status", "orderType", "deliveryStatus",
    "paymentStatus", "total", "total", "createdAt", "updatedAt", "assignedDriverId",
    "assignedAt", "pickedUpAt", "deliveredAt", "checkoutRequestId", "recipientName",
    "recipientPhone", "deliveryAddress", "deliveryInstructions"
FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_paymentSessionId_key" ON "Order"("paymentSessionId");
CREATE UNIQUE INDEX "Order_checkoutRequestId_key" ON "Order"("checkoutRequestId");
CREATE INDEX "Order_assignedDriverId_deliveryStatus_idx" ON "Order"("assignedDriverId", "deliveryStatus");
CREATE INDEX "Order_branchId_orderType_deliveryStatus_idx" ON "Order"("branchId", "orderType", "deliveryStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE UNIQUE INDEX "PaymentEvent_providerEventId_key" ON "PaymentEvent"("providerEventId");
CREATE INDEX "PaymentEvent_orderId_createdAt_idx" ON "PaymentEvent"("orderId", "createdAt");
