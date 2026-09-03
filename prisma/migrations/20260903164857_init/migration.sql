-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "riskAppetite" TEXT NOT NULL DEFAULT 'BALANCED',
    "monthlyIncomeCents" INTEGER
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startingCents" INTEGER NOT NULL,
    CONSTRAINT "Account_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fundId" TEXT,
    CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Category_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Month" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "expectedIncomeCents" INTEGER NOT NULL,
    CONSTRAINT "Month_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assignedCents" INTEGER NOT NULL,
    CONSTRAINT "Allocation_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "Month" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Allocation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetCents" INTEGER,
    "targetDate" DATETIME,
    "balanceCents" INTEGER NOT NULL,
    CONSTRAINT "Fund_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FundDraw" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundId" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    CONSTRAINT "FundDraw_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FundDraw_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "Month" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT,
    "fundDrawId" TEXT,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "payee" TEXT NOT NULL,
    "note" TEXT,
    "externalId" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "reviewState" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_fundDrawId_fkey" FOREIGN KEY ("fundDrawId") REFERENCES "FundDraw" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LifeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "evidence" TEXT,
    "seasonStart" DATETIME,
    CONSTRAINT "LifeEvent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Goal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_fundId_key" ON "Category"("fundId");

-- CreateIndex
CREATE UNIQUE INDEX "Month_householdId_year_month_key" ON "Month"("householdId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_monthId_categoryId_key" ON "Allocation"("monthId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_accountId_externalId_key" ON "Transaction"("accountId", "externalId");
