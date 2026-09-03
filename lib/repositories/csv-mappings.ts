/**
 * Saved CSV column mappings repository (D4) — one mapping per bank export
 * format, household-scoped. The mapping payload is JSON in a String column
 * (SQLite exposes no Json scalar in Prisma); parsing it back is validated,
 * never trusted: a row stored by an older shape fails loudly, not silently.
 */

import type { CsvColumnMapping } from "@/src/feed/types";

import { RepositoryError } from "./errors";
import type { Db } from "./engine-state";

export interface SavedCsvMapping {
  id: string;
  name: string;
  mapping: CsvColumnMapping;
}

function parseStoredMapping(raw: string, name: string): CsvColumnMapping {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RepositoryError(
      "INVALID_MAPPING",
      `Saved mapping "${name}" is corrupt — delete and re-save it.`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as CsvColumnMapping).date !== "string" ||
    typeof (parsed as CsvColumnMapping).payee !== "string" ||
    typeof (parsed as CsvColumnMapping).amount !== "string"
  ) {
    throw new RepositoryError(
      "INVALID_MAPPING",
      `Saved mapping "${name}" is missing required columns — delete and re-save it.`,
    );
  }
  return parsed as CsvColumnMapping;
}

/** Every saved mapping for the household, alphabetical by name. */
export async function listSavedCsvMappings(
  db: Db,
  householdId: string,
): Promise<SavedCsvMapping[]> {
  const rows = await db.csvMapping.findMany({
    where: { householdId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, mapping: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    mapping: parseStoredMapping(row.mapping, row.name),
  }));
}

/**
 * Create or overwrite the household's mapping under `name` (same-named
 * mapping = same export format, so re-saving updates it in place).
 */
export async function saveCsvMapping(
  db: Db,
  householdId: string,
  name: string,
  mapping: CsvColumnMapping,
): Promise<{ id: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new RepositoryError("INVALID_NAME", "Name the mapping.");
  }
  const row = await db.csvMapping.upsert({
    where: {
      householdId_name: { householdId, name: trimmedName },
    },
    create: {
      householdId,
      name: trimmedName,
      mapping: JSON.stringify(mapping),
    },
    update: { mapping: JSON.stringify(mapping) },
    select: { id: true },
  });
  return { id: row.id };
}

/**
 * Delete an owned saved mapping. Throws NOT_FOUND for another household's
 * mapping — same signal a missing row gives, never leak existence.
 */
export async function deleteCsvMapping(
  db: Db,
  householdId: string,
  id: string,
): Promise<void> {
  const deleted = await db.csvMapping.deleteMany({
    where: { id, householdId },
  });
  if (deleted.count === 0) {
    throw new RepositoryError("NOT_FOUND", "Saved mapping not found.");
  }
}
