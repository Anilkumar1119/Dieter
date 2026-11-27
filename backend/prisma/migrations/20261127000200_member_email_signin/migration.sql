ALTER TYPE "ChallengePurpose" ADD VALUE 'SIGN_IN';

ALTER TABLE "Member" ADD COLUMN "loginEmail" VARCHAR(254);

-- Only assign email identities when a single member owns the address.
WITH unique_addresses AS (
  SELECT lower(btrim("email")) AS address
  FROM "Member"
  WHERE "email" IS NOT NULL AND btrim("email") <> ''
  GROUP BY lower(btrim("email"))
  HAVING count(*) = 1
)
UPDATE "Member" AS member
SET "loginEmail" = addresses.address
FROM unique_addresses AS addresses
WHERE lower(btrim(member."email")) = addresses.address;

CREATE UNIQUE INDEX "Member_loginEmail_key" ON "Member"("loginEmail");
