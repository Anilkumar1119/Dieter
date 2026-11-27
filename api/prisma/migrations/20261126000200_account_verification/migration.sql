ALTER TABLE "AccountChallenge" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Store one active challenge record per user and purpose.
CREATE UNIQUE INDEX "AccountChallenge_userId_purpose_key"
  ON "AccountChallenge"("userId", "purpose");
