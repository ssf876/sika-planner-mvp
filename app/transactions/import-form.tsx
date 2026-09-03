"use client";

import { useActionState, useState } from "react";

import {
  applyCsvImportAction,
  previewCsvImportAction,
} from "@/app/actions/csv-import";
import {
  initialCsvImportState,
  type CsvImportFormState,
} from "@/app/actions/csv-import-state";
import { parseCsv } from "@/src/feed/csv";
import { suggestMapping } from "@/src/feed/mapping";
import type { CsvColumnMapping } from "@/src/feed/types";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export interface ImportAccount {
  id: string;
  name: string;
}

export interface ImportSavedMapping {
  id: string;
  name: string;
  mapping: CsvColumnMapping;
}

const EMPTY_MAPPING: Partial<CsvColumnMapping> = {};

const MAPPING_FIELDS = [
  { key: "date", label: "Date column", required: true },
  { key: "payee", label: "Payee column", required: true },
  { key: "amount", label: "Amount column", required: true },
  { key: "memo", label: "Memo column", required: false },
  { key: "externalId", label: "Transaction ID column", required: false },
  { key: "pending", label: "Pending/status column", required: false },
] as const;

type MappingKey = (typeof MAPPING_FIELDS)[number]["key"];

/**
 * CSV import (D4): upload → map columns → preview → apply. Column mapping is
 * state in this component so a saved mapping or the header-based suggestion
 * can prefill it; the server re-derives everything from the submitted fields.
 */
export function ImportForm({
  accounts,
  savedMappings,
}: {
  accounts: ImportAccount[];
  savedMappings: ImportSavedMapping[];
}) {
  const [previewState, previewAction, previewPending] = useActionState(
    previewCsvImportAction,
    initialCsvImportState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyCsvImportAction,
    initialCsvImportState,
  );

  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<CsvColumnMapping>>(
    EMPTY_MAPPING,
  );
  const [fileName, setFileName] = useState<string | null>(null);

  function setField(key: MappingKey, column: string) {
    setMapping((current) => {
      const next = { ...current };
      if (column) next[key] = column;
      else delete next[key];
      return next;
    });
  }

  async function handleFileChange(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setFileName(file.name);
    // Header detection + suggestion run in the browser for an instant
    // prefill; the server re-parses authoritatively on preview.
    const text = await file.text();
    const first = parseCsv(text)[0] ?? [];
    setHeaders(first);
    setMapping(suggestMapping(first));
  }

  function applySavedMapping(id: string) {
    const saved = savedMappings.find((entry) => entry.id === id);
    if (saved) setMapping(saved.mapping);
  }

  const preview = previewState.preview;
  const summary = applyState.summary;

  return (
    <div className="stack">
      <form action={previewAction} className="stack">
        {previewState.error ? (
          <p role="alert" className="form-error">
            {previewState.error}
          </p>
        ) : null}

        <label className="field">
          <span>Export file (.csv)</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            onChange={(event) => void handleFileChange(event.target.files)}
          />
        </label>

        {headers.length > 0 ? (
          <p className="hint">
            {fileName}: {headers.length} columns —{" "}
            {headers.map((header, index) => (
              <span key={`${header}-${index}`}>
                {index > 0 ? ", " : ""}
                <code>{header}</code>
              </span>
            ))}
          </p>
        ) : null}

        {savedMappings.length > 0 ? (
          <label className="field">
            <span>Use a saved mapping</span>
            <select
              defaultValue=""
              onChange={(event) => applySavedMapping(event.target.value)}
            >
              <option value="" disabled>
                Pick a saved mapping…
              </option>
              {savedMappings.map((saved) => (
                <option key={saved.id} value={saved.id}>
                  {saved.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <fieldset className="stack">
          <legend>Column mapping</legend>
          {MAPPING_FIELDS.map((field) => {
            const selected = mapping[field.key];
            return (
            <label className="field" key={field.key}>
              <span>
                {field.label}
                {field.required ? "" : " (optional)"}
              </span>
              <select
                name={`map${field.key.charAt(0).toUpperCase()}${field.key.slice(1)}`}
                value={mapping[field.key] ?? ""}
                onChange={(event) => setField(field.key, event.target.value)}
                required={field.required}
              >
                <option value="" disabled={field.required}>
                  {field.required ? "Choose a column…" : "Not imported"}
                </option>
                {/* A saved mapping may name a column this export doesn't have —
                    keep it selectable so the user sees (and can fix) it. */}
                {selected && !headers.includes(selected) ? (
                  <option value={selected}>{selected}</option>
                ) : null}
                {headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
            );
          })}
        </fieldset>

        <Button type="submit" variant="secondary" disabled={previewPending}>
          {previewPending ? "Reading…" : "Preview import"}
        </Button>
      </form>

      {preview ? (
        <section className="stack">
          <h3>Preview</h3>
          <p className="hint">
            {preview.validCount} rows will import · {preview.duplicateCount}{" "}
            in-file {preview.duplicateCount === 1 ? "duplicate" : "duplicates"}{" "}
            skipped · {preview.malformed.length}{" "}
            {preview.malformed.length === 1 ? "row" : "rows"} can&apos;t be read
          </p>

          {preview.sample.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row) => (
                  <tr key={row.externalId}>
                    <td>{row.date}</td>
                    <td>{row.payee}</td>
                    <td>{formatCents(row.amountCents)}</td>
                    <td>{row.pending ? "Pending" : "Posted"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {preview.malformed.length > 0 ? (
            <div>
              <h4>Rows that will be skipped</h4>
              <ul>
                {preview.malformed.map((row) => (
                  <li key={row.row}>
                    Row {row.row}: {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form action={applyAction} className="stack">
            <input type="hidden" name="csvBase64" value={preview.csvBase64} />
            <input
              type="hidden"
              name="mappingJson"
              value={preview.mappingJson}
            />

            <label className="field">
              <span>Import into</span>
              <select name="accountId" required defaultValue="">
                <option value="" disabled>
                  Choose an account…
                </option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <Input
              label="Save this mapping as (optional)"
              name="mappingName"
              placeholder="Acme Checking export"
              hint="Reuse it next time — same bank, same format."
            />

            <Button
              type="submit"
              disabled={applyPending || preview.validCount === 0}
            >
              {applyPending
                ? "Importing…"
                : `Import ${preview.validCount} rows`}
            </Button>
            {applyState.error ? (
              <p role="alert" className="form-error">
                {applyState.error}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {summary ? (
        <section className="stack" role="status">
          <h3>Import complete</h3>
          <p>
            Imported {summary.imported} row
            {summary.imported === 1 ? "" : "s"}.
            {summary.skippedDuplicates > 0
              ? ` Skipped ${summary.skippedDuplicates} already-imported ${
                  summary.skippedDuplicates === 1 ? "row" : "rows"
                } (importing the same file twice is safe).`
              : ""}
            {summary.malformed.length > 0
              ? ` ${summary.malformed.length} ${
                  summary.malformed.length === 1 ? "row was" : "rows were"
                } skipped as unreadable.`
              : ""}
          </p>
          {summary.duplicateExternalIds.length > 0 ? (
            <p className="hint">
              Already in this account: {summary.duplicateExternalIds.join(", ")}
            </p>
          ) : null}
          {summary.malformed.length > 0 ? (
            <ul>
              {summary.malformed.map((row) => (
                <li key={row.row}>
                  Row {row.row}: {row.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="hint">
            Imported rows are waiting in the review queue — categorize them to
            move them into the plan.
          </p>
        </section>
      ) : null}
    </div>
  );
}
