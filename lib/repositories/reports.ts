/**
 * Reports repository (D9) — read views over hydrated engine state. The report
 * math is pure (src/engine/pva.ts); this layer only attaches display names
 * and keeps household scoping on every query.
 */

import type { CategoryGroup } from "@prisma/client";

import {
  createBudgetEngine,
  monthLabelOf,
  type PlannedVsActualReport,
  type PvaCategoryRow,
} from "@/src/engine";

import { CATEGORY_GROUP_ORDER } from "@/lib/onboarding/seed";

import { loadHouseholdEngineState, type Db } from "./engine-state";

export interface ReportCategoryRow extends PvaCategoryRow {
  categoryName: string;
  group: CategoryGroup;
}

export interface MonthReport {
  monthId: string;
  label: string;
  report: PlannedVsActualReport;
  /** Report rows with names attached, mock-up group order then name. */
  categories: ReportCategoryRow[];
}

/**
 * The Planned-vs-Actual report for one calendar month, or null when the
 * household has no budget month for it yet (the page shows an empty state).
 */
export async function listMonthReport(
  db: Db,
  householdId: string,
  input: { year: number; month: number },
): Promise<MonthReport | null> {
  const state = await loadHouseholdEngineState(db, householdId);
  const month = state.months.find(
    (m) => m.year === input.year && m.month === input.month,
  );
  if (!month) return null;

  const engine = createBudgetEngine(state);
  const report = engine.plannedVsActual(month.id);
  const categories = report.categories.map((row): ReportCategoryRow => {
    const category = state.categories.find((c) => c.id === row.categoryId);
    if (!category) {
      throw new Error("report row references a category missing from state");
    }
    return { ...row, categoryName: category.name, group: category.group };
  });
  categories.sort(
    (a, b) =>
      groupRank(a.group) - groupRank(b.group) ||
      a.categoryName.localeCompare(b.categoryName),
  );

  return {
    monthId: month.id,
    label: monthLabelOf(month.year, month.month),
    report,
    categories,
  };
}

function groupRank(group: CategoryGroup): number {
  const rank = CATEGORY_GROUP_ORDER.indexOf(group);
  return rank === -1 ? CATEGORY_GROUP_ORDER.length : rank;
}
