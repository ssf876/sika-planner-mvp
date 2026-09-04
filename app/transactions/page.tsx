import { AppShell } from "@/components/shell/AppShell";
import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { deleteCsvMappingAction } from "@/app/actions/csv-import";
import { listSavedCsvMappings } from "@/lib/repositories/csv-mappings";
import {
  getAutoAcceptSuggestions,
  loadReviewQueue,
} from "@/lib/repositories/categorizer";

import { ImportForm } from "./import-form";
import { TransactionEntryForm } from "./entry-form";
import { ReviewQueue } from "./review-queue";
import { TransferForm } from "./transfer-form";

export const metadata = { title: "Enter transactions — Sika Planner" };

/** Household-local calendar date (engine dates are YYYY-MM-DD, spec A4). */
function todayCalendarDate(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export default async function TransactionsPage() {
  const user = await requireOnboardedUser();
  const householdId = user.householdId;
  const today = todayCalendarDate();

  const [accounts, categories, savedMappings, reviewQueue, autoAccept] =
    await Promise.all([
      prisma.account.findMany({
        where: { householdId },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
      prisma.category.findMany({
        where: { householdId },
        orderBy: [{ group: "asc" }, { name: "asc" }],
        select: { id: true, name: true, group: true },
      }),
      listSavedCsvMappings(prisma, householdId),
      loadReviewQueue(prisma, householdId),
      getAutoAcceptSuggestions(prisma, householdId),
    ]);

  return (
    <AppShell active="activity" title="Activity" email={user.email}>
      <div className="stack">
        <section className="card">
          <h2>Review queue</h2>
          <p className="hint">
            Imported rows waiting for a category, with a suggestion from the
            ones you confirmed before. Confirm as suggested, or pick another
            category — either way the categorizer learns.
          </p>
          <ReviewQueue
            rows={reviewQueue}
            categories={categories}
            autoAccept={autoAccept}
          />
        </section>

        <section className="card">
          <h2>Manual entry</h2>
          <p className="hint">
            Spending depletes its category immediately; income raises Ready to
            Assign.
          </p>
          {accounts.length > 0 ? (
            <TransactionEntryForm
              accounts={accounts}
              categories={categories}
              today={today}
            />
          ) : (
            <p className="hint">
              Add an account on the dashboard before recording transactions.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Transfer between accounts</h2>
          <p className="hint">
            Card payments, ATM withdrawals, moving cash — never spending.
          </p>
          {accounts.length >= 2 ? (
            <TransferForm accounts={accounts} today={today} />
          ) : (
            <p className="hint">
              Transfers need two accounts — add another one first.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Import a bank export (CSV)</h2>
          <p className="hint">
            Map the columns once, preview what will import, then stage it.
            Importing the same file twice never doubles rows.
          </p>
          {accounts.length > 0 ? (
            <ImportForm accounts={accounts} savedMappings={savedMappings} />
          ) : (
            <p className="hint">
              Add an account on the dashboard before importing.
            </p>
          )}
          {savedMappings.length > 0 ? (
            <div>
              <h3>Saved mappings</h3>
              <ul>
                {savedMappings.map((saved) => (
                  <li key={saved.id}>
                    {saved.name} — {saved.mapping.date}, {saved.mapping.payee},{" "}
                    {saved.mapping.amount}
                    <form action={deleteCsvMappingAction}>
                      <input type="hidden" name="mappingId" value={saved.id} />
                      <button type="submit">Delete</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
