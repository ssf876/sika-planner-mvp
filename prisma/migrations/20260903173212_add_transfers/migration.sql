-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "payee" TEXT NOT NULL,
    CONSTRAINT "Transfer_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
