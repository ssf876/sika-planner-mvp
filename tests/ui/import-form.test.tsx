import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportForm } from "@/app/transactions/import-form";

// jsdom's File lacks Blob#text(); emulate it for the upload flow.
beforeAll(() => {
  File.prototype.text = function text(): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this as unknown as Blob);
    });
  };
});
import type { CsvImportFormState } from "@/app/actions/csv-import";

const { initialCsvImportState, previewCsvImportAction, applyCsvImportAction } =
  vi.hoisted(() => {
    const initialCsvImportState: CsvImportFormState = {
      stage: "input",
      error: null,
    };
    const previewCsvImportAction = vi.fn<
      (
        prev: CsvImportFormState,
        formData: FormData,
      ) => Promise<CsvImportFormState>
    >(async () => initialCsvImportState);
    const applyCsvImportAction = vi.fn<
      (
        prev: CsvImportFormState,
        formData: FormData,
      ) => Promise<CsvImportFormState>
    >(async () => initialCsvImportState);
    return {
      initialCsvImportState,
      previewCsvImportAction,
      applyCsvImportAction,
    };
  });

vi.mock("@/app/actions/csv-import", () => ({
  initialCsvImportState,
  previewCsvImportAction,
  applyCsvImportAction,
}));

const accounts = [
  { id: "acc-1", name: "Everyday" },
  { id: "acc-2", name: "Wallet" },
];

const savedMappings = [
  {
    id: "map-1",
    name: "Generic export",
    mapping: {
      date: "Posted Date",
      payee: "Name",
      amount: "Value",
      externalId: "Reference",
    },
  },
];

const previewedState: CsvImportFormState = {
  stage: "previewed",
  error: null,
  preview: {
    sample: [
      {
        date: "2026-09-01",
        payee: "Whole Foods Market",
        amountCents: -8640,
        pending: false,
        externalId: "TXN-9001",
      },
    ],
    malformed: [{ row: 3, reason: "amount is not a number" }],
    validCount: 5,
    duplicateCount: 1,
    csvBase64: "YWJj",
    mappingJson: '{"date":"Date","payee":"Description","amount":"Amount"}',
  },
};

const importedState: CsvImportFormState = {
  stage: "imported",
  error: null,
  summary: {
    imported: 5,
    skippedDuplicates: 6,
    duplicateExternalIds: ["TXN-9001"],
    malformed: [],
  },
};

const exportCsv = [
  "Transaction ID,Date,Description,Amount,Status",
  "TXN-9001,2026-09-01,Whole Foods Market,-86.40,POSTED",
].join("\n");

function uploadedFile() {
  return new File([exportCsv], "export.csv", { type: "text/csv" });
}

beforeEach(() => {
  previewCsvImportAction.mockClear();
  applyCsvImportAction.mockClear();
  previewCsvImportAction.mockResolvedValue(initialCsvImportState);
  applyCsvImportAction.mockResolvedValue(initialCsvImportState);
});

describe("ImportForm", () => {
  it("previews a mapped export and exposes the apply step", async () => {
    previewCsvImportAction.mockResolvedValue(previewedState);
    const user = userEvent.setup();
    render(<ImportForm accounts={accounts} savedMappings={[]} />);

    await user.upload(screen.getByLabelText(/Export file/), uploadedFile());
    // Header detection + suggestion run client-side as soon as the file lands.
    expect(await screen.findByText(/5 columns/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Preview")).toBeVisible();
    expect(
      screen.getByText(/5 rows will import · 1 in-file duplicate skipped/),
    ).toBeVisible();
    expect(screen.getByText(/Row 3: amount is not a number/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Import 5 rows" }),
    ).toBeEnabled();
  });

  it("carries the file and mapping through hidden fields to apply", async () => {
    previewCsvImportAction.mockResolvedValue(previewedState);
    applyCsvImportAction.mockResolvedValue(importedState);
    const user = userEvent.setup();
    render(<ImportForm accounts={accounts} savedMappings={[]} />);

    await user.upload(screen.getByLabelText(/Export file/), uploadedFile());
    await screen.findByText(/5 columns/);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview");

    await user.selectOptions(screen.getByLabelText("Import into"), "acc-2");
    await user.click(screen.getByRole("button", { name: "Import 5 rows" }));

    expect(applyCsvImportAction).toHaveBeenCalledTimes(1);
    const call = applyCsvImportAction.mock.calls[0];
    if (!call) throw new Error("action was not called");
    const [, formData] = call;
    expect(String(formData.get("accountId"))).toBe("acc-2");
    expect(String(formData.get("csvBase64"))).toBe("YWJj");
    expect(String(formData.get("mappingJson"))).toContain('"date":"Date"');
  });

  it("renders the import summary with the idempotency note", async () => {
    previewCsvImportAction.mockResolvedValue(previewedState);
    applyCsvImportAction.mockResolvedValue(importedState);
    const user = userEvent.setup();
    render(<ImportForm accounts={accounts} savedMappings={[]} />);

    await user.upload(screen.getByLabelText(/Export file/), uploadedFile());
    await screen.findByText(/5 columns/);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await user.selectOptions(screen.getByLabelText("Import into"), "acc-1");
    await user.click(
      await screen.findByRole("button", { name: "Import 5 rows" }),
    );

    expect(await screen.findByText("Import complete")).toBeVisible();
    expect(screen.getByText(/Imported 5 rows\./)).toBeVisible();
    expect(screen.getByText(/Skipped 6 already-imported rows/)).toBeVisible();
    expect(screen.getByText(/Already in this account: TXN-9001/)).toBeVisible();
  });

  it("lets a saved mapping override the header suggestion", async () => {
    const user = userEvent.setup();
    render(<ImportForm accounts={accounts} savedMappings={savedMappings} />);

    await user.upload(screen.getByLabelText(/Export file/), uploadedFile());
    await screen.findByText(/5 columns/);

    const dateSelect = screen.getByLabelText("Date column");
    // The generic suggestion prefills first…
    expect(dateSelect).toHaveValue("Date");

    // …then a saved mapping takes over.
    await user.selectOptions(
      screen.getByLabelText("Use a saved mapping"),
      "map-1",
    );
    expect(screen.getByLabelText("Date column")).toHaveValue("Posted Date");
    expect(screen.getByLabelText("Payee column")).toHaveValue("Name");
    expect(screen.getByLabelText("Amount column")).toHaveValue("Value");
    expect(screen.getByLabelText(/^Transaction ID column/)).toHaveValue(
      "Reference",
    );
  });
});
