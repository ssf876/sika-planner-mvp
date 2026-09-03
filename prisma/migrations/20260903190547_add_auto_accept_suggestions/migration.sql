-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "riskAppetite" TEXT NOT NULL DEFAULT 'BALANCED',
    "monthlyIncomeCents" INTEGER,
    "autoAcceptSuggestions" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Household" ("id", "monthlyIncomeCents", "name", "riskAppetite") SELECT "id", "monthlyIncomeCents", "name", "riskAppetite" FROM "Household";
DROP TABLE "Household";
ALTER TABLE "new_Household" RENAME TO "Household";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
