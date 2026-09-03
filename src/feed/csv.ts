// RFC 4180 CSV parsing — quoted fields, doubled quotes, CRLF or LF endings.
// Dependency-free and isomorphic: the same parser powers the browser's
// mapping preview and the server-side import, so what the user previewed is
// exactly what imports.

/** Thrown for structural CSV damage a user must fix in their export. */
export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

/**
 * Parse CSV text into rows of fields. Row and field counts may vary per row —
 * the mapping layer decides which missing cells matter.
 */
export function parseCsv(input: string): string[][] {
  // A Windows-exported file often opens with a BOM; strip it so the first
  // header is "Date", not "\uFEFFDate".
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field !== "") {
        // `ab"c` is not valid CSV — quote only starts a field at its start.
        throw new CsvParseError(
          `Unexpected quote inside an unquoted field on row ${rows.length + 1}`,
        );
      }
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new CsvParseError("Unclosed quoted field at end of file");
  }
  // Final row without a trailing newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
