"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import {
  engineErrorMessage,
  RepositoryError,
} from "@/lib/repositories/errors";
import { importFromFeed } from "@/lib/repositories/csv-import";
import {
  deleteCsvMapping,
  saveCsvMapping,
} from "@/lib/repositories/csv-mappings";
import { CsvFeed } from "@/src/feed/csv-feed";
import { parseCsv } from "@/src/feed/csv";
import { applyCsvMapping } from "@/src/feed/mapping";
import type { CsvColumnMapping } from "@/src/feed/types";
import type { CsvImportFormState } from "./csv-import-state";

/** Malformed rows and duplicate reports shown to the user, capped for display. */
const MALFORMED_REPORT_LIMIT = 50;
const SAMPLE_ROW_LIMIT = 8;

function mappingFromForm(formData: FormData): CsvColumnMapping | null {
  const mapping: CsvColumnMapping = {
    date: String(formData.get("mapDate") ?? "").trim(),
    payee: String(formData.get("mapPayee") ?? "").trim(),
    amount: String(formData.get("mapAmount") ?? "").trim(),
  };
  const memo = String(formData.get("mapMemo") ?? "").trim();
  const externalId = String(formData.get("mapExternalId") ?? "").trim();
  const pending = String(formData.get("mapPending") ?? "").trim();
  if (memo) mapping.memo = memo;
  if (externalId) mapping.externalId = externalId;
  if (pending) mapping.pending = pending;

  if (!mapping.date || !mapping.payee || !mapping.amount) return null;
  return mapping;
}

/**
 * Re-validate the mapping JSON that round-tripped through the browser
 * (hidden field). Never trust client state: apply the same shape bar the
 * saved-mapping loader uses.
 */
function mappingFromJson(mappingJson: string): CsvColumnMapping | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(mappingJson);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as CsvColumnMapping).date !== "string" ||
    typeof (parsed as CsvColumnMapping).payee !== "string" ||
    typeof (parsed as CsvColumnMapping).amount !== "string"
  ) {
    return null;
  }
  return parsed as CsvColumnMapping;
}

/**
 * Step 1 of the import: parse the upload against the chosen column mapping
 * and show what would happen. Nothing touches the ledger yet.
 */
export async function previewCsvImportAction(
  _prev: CsvImportFormState,
  formData: FormData,
): Promise<CsvImportFormState> {
  await requireOnboardedUser();

  const file = formData.get("file");
  const pasted = String(formData.get("csvText") ?? "");
  const csvText =
    file instanceof File && file.size > 0
      ? await file.text()
      : pasted.trim() || null;
  if (!csvText) {
    return { stage: "input", error: "Choose a CSV file to import." };
  }

  const mapping = mappingFromForm(formData);
  if (!mapping) {
    return {
      stage: "input",
      error: "Map the date, payee, and amount columns to continue.",
    };
  }

  if (parseCsv(csvText).length === 0) {
    return { stage: "input", error: "The file is empty." };
  }

  const mapped = applyCsvMapping(csvText, mapping);
  // A missing mapped column or structural CSV damage is a mapping error —
  // bounce back to the mapping step rather than previewing a broken import.
  const structural = mapped.malformed.find(
    (row) =>
      row.row === 1 &&
      (row.reason.includes("could not be found") ||
        row.reason.includes("Unclosed quoted field") ||
        row.reason.includes("quote")),
  );
  if (structural) {
    return { stage: "input", error: structural.reason };
  }

  return {
    stage: "previewed",
    error: null,
    preview: {
      sample: mapped.transactions.slice(0, SAMPLE_ROW_LIMIT).map((tx) => ({
        date: tx.date,
        payee: tx.payee,
        amountCents: tx.amountCents,
        pending: tx.pending,
        externalId: tx.externalId,
      })),
      malformed: mapped.malformed.slice(0, MALFORMED_REPORT_LIMIT),
      validCount: mapped.transactions.length,
      duplicateCount: mapped.duplicates.length,
      csvBase64: Buffer.from(csvText, "utf8").toString("base64"),
      mappingJson: JSON.stringify(mapping),
    },
  };
}

/**
 * Step 2: stage the previewed rows into the ledger. Re-running the same
 * file is a no-op — per-account dedupe on accountId+externalId.
 */
export async function applyCsvImportAction(
  _prev: CsvImportFormState,
  formData: FormData,
): Promise<CsvImportFormState> {
  const user = await requireOnboardedUser();

  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) {
    return { stage: "input", error: "Choose an account." };
  }

  const csvBase64 = String(formData.get("csvBase64") ?? "");
  const mapping = mappingFromJson(String(formData.get("mappingJson") ?? ""));
  if (!csvBase64 || !mapping) {
    return { stage: "input", error: "Preview the file before importing." };
  }

  const saveName = String(formData.get("mappingName") ?? "").trim();
  try {
    if (saveName) {
      await saveCsvMapping(prisma, user.householdId, saveName, mapping);
    }
    const csvText = Buffer.from(csvBase64, "base64").toString("utf8");
    const summary = await importFromFeed(
      prisma,
      user.householdId,
      accountId,
      new CsvFeed(csvText, mapping),
    );
    revalidatePath("/transactions");
    revalidatePath("/dashboard");

    return {
      stage: "imported",
      error: null,
      summary: {
        imported: summary.imported,
        skippedDuplicates: summary.skippedDuplicates,
        duplicateExternalIds: summary.duplicateExternalIds,
        // Malformed rows never block an import; report them alongside.
        malformed: applyCsvMapping(csvText, mapping).malformed.slice(
          0,
          MALFORMED_REPORT_LIMIT,
        ),
      },
    };
  } catch (error) {
    const message = engineErrorMessage(error);
    if (message) return { stage: "input", error: message };
    if (error instanceof RepositoryError) {
      return { stage: "input", error: error.message };
    }
    throw error; // unexpected failures surface, never swallow
  }
}

/** Server-rendered delete buttons in the saved-mappings list post here. */
export async function deleteCsvMappingAction(formData: FormData): Promise<void> {
  const user = await requireOnboardedUser();
  const id = String(formData.get("mappingId") ?? "");
  if (!id) return;
  try {
    await deleteCsvMapping(prisma, user.householdId, id);
  } catch (error) {
    if (error instanceof RepositoryError) return; // already gone — nothing to do
    throw error;
  }
  revalidatePath("/transactions");
}
