-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'OFFLINE_UPI', 'ONLINE_UPI');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('OPEN', 'CAPTURED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChallengePurpose" AS ENUM ('SETUP', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('DUE_SOON', 'DUE_TODAY', 'ADMIN_DUE_DIGEST', 'PAYMENT_RECEIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "passwordHash" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "age" INTEGER NOT NULL,
    "email" VARCHAR(254),
    "admissionDate" DATE NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePlan" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "currentPlanId" UUID NOT NULL,
    "pendingPlanId" UUID,
    "cycleAnchorDate" DATE NOT NULL,
    "nextBillingDate" DATE NOT NULL,
    "endsOn" DATE,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "planName" VARCHAR(80) NOT NULL,
    "planIntervalMonths" INTEGER NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "providerPaymentId" TEXT,
    "reference" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutAttempt" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("providerEventId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "ChallengePurpose" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "billId" UUID,
    "kind" "NotificationKind" NOT NULL,
    "message" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "succeeded" BOOLEAN,
    "summary" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_key" ON "Member"("userId");

-- CreateIndex
CREATE INDEX "Member_fullName_idx" ON "Member"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "FeePlan_name_key" ON "FeePlan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_memberId_key" ON "Membership"("memberId");

-- CreateIndex
CREATE INDEX "Membership_nextBillingDate_idx" ON "Membership"("nextBillingDate");

-- CreateIndex
CREATE INDEX "Bill_status_dueDate_idx" ON "Bill"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_membershipId_periodStart_key" ON "Bill"("membershipId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_billId_receivedAt_idx" ON "Payment"("billId", "receivedAt");

-- CreateIndex
CREATE INDEX "Payment_receivedAt_idx" ON "Payment"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_providerOrderId_key" ON "CheckoutAttempt"("providerOrderId");

-- CreateIndex
CREATE INDEX "CheckoutAttempt_billId_status_idx" ON "CheckoutAttempt"("billId", "status");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AccountChallenge_userId_purpose_expiresAt_idx" ON "AccountChallenge"("userId", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_deduplicationKey_key" ON "Notification"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_name_businessDate_startedAt_idx" ON "JobRun"("name", "businessDate", "startedAt");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_currentPlanId_fkey" FOREIGN KEY ("currentPlanId") REFERENCES "FeePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "FeePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountChallenge" ADD CONSTRAINT "AccountChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Protect billing values even when written by jobs or imported directly.
ALTER TABLE "User"
  ADD CONSTRAINT "User_phone_e164_check" CHECK ("phone" ~ '^\+[1-9][0-9]{1,14}$');

ALTER TABLE "Member"
  ADD CONSTRAINT "Member_age_check" CHECK ("age" BETWEEN 1 AND 130);

ALTER TABLE "FeePlan"
  ADD CONSTRAINT "FeePlan_amount_check" CHECK ("amountPaise" > 0),
  ADD CONSTRAINT "FeePlan_interval_check" CHECK ("intervalMonths" IN (1, 3, 12));

ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_dates_check" CHECK ("periodEnd" > "periodStart" AND "dueDate" >= "periodStart"),
  ADD CONSTRAINT "Bill_amount_check" CHECK ("amountPaise" > 0),
  ADD CONSTRAINT "Bill_interval_check" CHECK ("planIntervalMonths" IN (1, 3, 12));

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_check" CHECK ("amountPaise" > 0),
  ADD CONSTRAINT "Payment_online_reference_check" CHECK ("method" <> 'ONLINE_UPI' OR "providerPaymentId" IS NOT NULL);

ALTER TABLE "CheckoutAttempt"
  ADD CONSTRAINT "CheckoutAttempt_amount_check" CHECK ("amountPaise" > 0);
