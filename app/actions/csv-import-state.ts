import type { MalformedRow } from "@/src/feed/types";

/**
 * Form-state contract shared by the CSV import server actions and the client
 * form. This lives OUTSIDE the "use server" module because Next.js only
 * allows async-function exports from server-action files — the initial state
 * must be importable by client components directly.
 */

/** One parsed preview row shown before staging the import. */
export interface CsvPreviewRow {
  date: string;
  payee: string;
  amountCents: number;
  pending: boolean;
  externalId: string;
}

export interface CsvImportFormState {
  stage: "input" | "previewed" | "imported";
  error: string | null;
  /** Present once a preview succeeded; hidden fields carry it into apply. */
  preview?: {
    sample: CsvPreviewRow[];
    /** Rows the mapping could not parse, with file row numbers. */
    malformed: MalformedRow[];
    validCount: number;
    duplicateCount: number;
    csvBase64: string;
    mappingJson: string;
  };
  summary?: {
    imported: number;
    skippedDuplicates: number;
    duplicateExternalIds: string[];
    malformed: MalformedRow[];
    /** Rows the categorizer auto-accepted (D5, per household setting). */
    autoAccepted?: number;
  };
}

export const initialCsvImportState: CsvImportFormState = {
  stage: "input",
  error: null,
};
