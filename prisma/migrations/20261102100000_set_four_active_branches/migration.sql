UPDATE "Branch"
SET "isActive" = CASE
  WHEN "name" IN (
    'Steakz City Centre',
    'Steakz Northside',
    'Steakz Southgate',
    'Steakz Uptown'
  ) THEN 1
  ELSE 0
END;

INSERT OR IGNORE INTO "BranchManagerAssignment" ("userId", "branchId")
SELECT "User"."id", "Branch"."id"
FROM "User"
CROSS JOIN "Branch"
WHERE "User"."email" = 'steakz.city.centre.manager@steakz.com'
  AND "User"."role" = 'BRANCH_MANAGER'
  AND "Branch"."name" IN (
    'Steakz City Centre',
    'Steakz Northside',
    'Steakz Southgate',
    'Steakz Uptown'
  );
