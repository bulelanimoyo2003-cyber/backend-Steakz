ALTER TABLE "Branch" ADD COLUMN "designatedDeliveryDriverId" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Branch_designatedDeliveryDriverId_key" ON "Branch"("designatedDeliveryDriverId");
