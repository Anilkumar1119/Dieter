ALTER TABLE "AccountChallenge"
  ADD COLUMN "codeDigest" VARCHAR(64),
  ADD COLUMN "otpEmail" VARCHAR(254);
