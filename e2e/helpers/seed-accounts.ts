import { PrismaClient } from "@prisma/client";
import path from "node:path";

// The e2e database the webServer migrates (DATABASE_URL file:./e2e.db,
// resolved against prisma/). v1 ships without account-creation UI (deferred
// with PR #8), so the happy-path spec seeds the household's accounts the way
// onboarding would have linked them — the same rows the dashboard's
// net-worth card and the transaction forms read.
const E2E_DB_URL = `file:${path.join(__dirname, "..", "..", "prisma", "e2e.db")}`;

export async function seedAccountsFor(email: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: E2E_DB_URL });
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { householdId: true },
    });
    if (!user.householdId) {
      throw new Error(`seedAccountsFor: ${email} has no household yet`);
    }
    await prisma.account.createMany({
      data: [
        {
          householdId: user.householdId,
          kind: "CHECKING",
          name: "Everyday Checking",
          startingCents: 120_000,
        },
        {
          householdId: user.householdId,
          kind: "CREDIT",
          name: "Visa Card",
          startingCents: 0,
        },
        {
          householdId: user.householdId,
          kind: "CASH",
          name: "Cash Wallet",
          startingCents: 4_000,
        },
      ],
    });
  } finally {
    await prisma.$disconnect();
  }
}
