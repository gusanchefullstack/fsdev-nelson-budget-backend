-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'COP');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('ONE_TIME', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'CUSTOM_DAYS', 'CUSTOM_MONTHS');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'BROKERAGE', 'WALLET', 'CASH');

-- CreateEnum
CREATE TYPE "PayorType" AS ENUM ('EMPLOYER', 'INVESTMENT', 'RENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('UTILITY', 'SUBSCRIPTION', 'STORE', 'SERVICE', 'OTHER');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "username" TEXT NOT NULL,
    "displayUsername" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phoneCountryCode" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "themePreference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" "Currency" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "estimatedAmount" DECIMAL(14,2) NOT NULL,
    "firstExpectedDate" DATE NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "customInterval" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bucket" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "expectedDate" DATE NOT NULL,
    "estimatedAmount" DECIMAL(14,2) NOT NULL,
    "actualAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "actualDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "AccountType" NOT NULL,
    "currency" "Currency" NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "currentBalance" DECIMAL(14,2) NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "state" TEXT,
    "country" TEXT,
    "phoneCountryCode" TEXT,
    "phoneNumber" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "money_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PayorType" NOT NULL,
    "currency" "Currency" NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "state" TEXT,
    "country" TEXT,
    "phoneCountryCode" TEXT,
    "phoneNumber" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Payor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "VendorType" NOT NULL,
    "currency" "Currency" NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "state" TEXT,
    "country" TEXT,
    "phoneCountryCode" TEXT,
    "phoneNumber" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "timezone" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "payorId" TEXT,
    "vendorId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_key_key" ON "rate_limit"("key");

-- CreateIndex
CREATE INDEX "Budget_userId_currency_idx" ON "Budget"("userId", "currency");

-- CreateIndex
CREATE INDEX "Category_budgetId_idx" ON "Category"("budgetId");

-- CreateIndex
CREATE INDEX "BudgetItem_categoryId_idx" ON "BudgetItem"("categoryId");

-- CreateIndex
CREATE INDEX "Bucket_itemId_startDate_idx" ON "Bucket"("itemId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "Bucket_itemId_sequence_key" ON "Bucket"("itemId", "sequence");

-- CreateIndex
CREATE INDEX "money_account_userId_idx" ON "money_account"("userId");

-- CreateIndex
CREATE INDEX "Payor_userId_idx" ON "Payor"("userId");

-- CreateIndex
CREATE INDEX "Vendor_userId_idx" ON "Vendor"("userId");

-- CreateIndex
CREATE INDEX "Transaction_userId_localDate_idx" ON "Transaction"("userId", "localDate");

-- CreateIndex
CREATE INDEX "Transaction_itemId_idx" ON "Transaction"("itemId");

-- CreateIndex
CREATE INDEX "Transaction_bucketId_idx" ON "Transaction"("bucketId");

-- CreateIndex
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX "Transaction_payorId_idx" ON "Transaction"("payorId");

-- CreateIndex
CREATE INDEX "Transaction_vendorId_idx" ON "Transaction"("vendorId");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bucket" ADD CONSTRAINT "Bucket_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BudgetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_account" ADD CONSTRAINT "money_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payor" ADD CONSTRAINT "Payor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BudgetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payorId_fkey" FOREIGN KEY ("payorId") REFERENCES "Payor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Constraints Prisma cannot express ----------

-- FR-010: no two budgets of the same user and currency with overlapping dates
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Budget" ADD CONSTRAINT "budget_no_overlap"
  EXCLUDE USING gist ("userId" WITH =, "currency" WITH =, daterange("startDate", "endDate", '[]') WITH &&);
ALTER TABLE "Budget" ADD CONSTRAINT "budget_dates_order" CHECK ("endDate" > "startDate");

-- Item dates and custom interval (FR-014)
ALTER TABLE "BudgetItem" ADD CONSTRAINT "item_dates_order" CHECK ("endDate" >= "startDate");
ALTER TABLE "BudgetItem" ADD CONSTRAINT "item_custom_interval" CHECK (
  ("frequency" IN ('CUSTOM_DAYS', 'CUSTOM_MONTHS') AND "customInterval" >= 1)
  OR ("frequency" NOT IN ('CUSTOM_DAYS', 'CUSTOM_MONTHS') AND "customInterval" IS NULL)
);

-- FR-041: income = payor -> account, expense = account -> vendor
ALTER TABLE "Transaction" ADD CONSTRAINT "transaction_counterparty" CHECK (
  ("type" = 'INCOME' AND "payorId" IS NOT NULL AND "vendorId" IS NULL)
  OR ("type" = 'EXPENSE' AND "vendorId" IS NOT NULL AND "payorId" IS NULL)
);
ALTER TABLE "Transaction" ADD CONSTRAINT "transaction_amount_positive" CHECK ("amount" > 0);
