CREATE TABLE "BranchManagerAssignment" (
    "userId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "branchId"),
    CONSTRAINT "BranchManagerAssignment_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BranchManagerAssignment_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BranchManagerAssignment_branchId_idx"
  ON "BranchManagerAssignment"("branchId");

INSERT INTO "BranchManagerAssignment" ("userId", "branchId")
SELECT "id", "branchId"
FROM "User"
WHERE "role" = 'BRANCH_MANAGER' AND "branchId" IS NOT NULL;
