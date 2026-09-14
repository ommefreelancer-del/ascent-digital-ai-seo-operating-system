// LOCAL, ZERO-DEPENDENCY XLSX WRITER (2026-09-02, multi-sheet 2026-09-03, readable-layout 2026-09-03):
// generates a real, minimal, valid XLSX workbook (ZIP + spreadsheetML) entirely from Node built-ins -- no
// external npm package (this environment has no network access to install one). The counterpart to
// spreadsheet-reader.ts's own reader: every cell is written as an INLINE STRING (t="inlineStr"), which is
// simpler than building a shared-strings table and is fully valid OOXML that Excel/Google Sheets/
// LibreOffice all open correctly. Uses the ZIP STORE (uncompressed) method for simplicity; a real CRC32 is
// still computed for every entry since some tools verify it even for stored entries. Round-trips correctly
// through this codebase's own readXlsx() -- see its test file for a direct proof. Supports multiple named
// sheets in one workbook (added for the Admin/Vendor + Client Websites traffic split -- see
// spreadsheet-business-schema.ts's own header) -- each sheet is a real, independent worksheet part.
//
// READABLE-LAYOUT FIX (2026-09-03): a real, live-confirmed defect -- every column was written at Excel's
// default width (~8.43 characters) regardless of content, so a long URL/email value visually overflowed
// across several neighboring (often empty, e.g. DA/PA/SS) cells, making the sheet look like fields were
// "cramped/overlapping" even though the underlying cell data was always correctly separated one value per
// cell. Fixed generically (no column-name-specific logic, so this stays valid for any headers passed in):
// each column's width is now computed from the real max content length actually present in that column
// (header + every row value), clamped to a sane [MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH] range, so a short
// column (e.g. "DA") renders narrow and a long one (e.g. a full URL) renders wide enough to read without
// bleeding into its neighbor. The header row is also bolded and frozen (pane split after row 1) so it
// stays visible and visually distinct while scrolling -- both via a minimal xl/styles.xml part and a
// <sheetViews>/<pane> declaration, the standard OOXML mechanisms Excel/Google Sheets/LibreOffice all read.
//
// WRAP-TEXT / FIXED-WIDTH FIX (2026-09-03): auto-width alone still lets an unusually long value (e.g. a
// page URL with a long path/query string) exceed MAX_COLUMN_WIDTH and visually spill into a neighboring,
// often-empty column -- the same "cramped/overlapping" problem, now for content longer than any width can
// reasonably accommodate. A caller can now (a) pass an explicit `columnWidths` override for specific
// columns (undefined entries still fall back to the generic auto-width above) and (b) mark specific
// columns via `wrapTextColumns` so their DATA cells (never the header) get `wrapText` alignment -- Excel/
// Google Sheets/LibreOffice then wrap long content onto multiple lines WITHIN that cell's own fixed width
// and grow the row's height, instead of ever overflowing horizontally into a neighboring cell. Both remain
// entirely column-INDEX-based and schema-agnostic -- this file still has no knowledge of column names; the
// caller (spreadsheet-business-schema.ts's consumers) decides which index needs which treatment.

export interface XlsxSheetInput {
  readonly name: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Optional explicit width override per column index; an `undefined` (or missing trailing) entry falls back to the generic content-derived auto-width. */
  readonly columnWidths?: readonly (number | undefined)[];
  /** Column indexes whose DATA cells (never the header) get wrap-text alignment, so long content wraps within the cell instead of spilling into a neighboring column. */
  readonly wrapTextColumns?: readonly number[];
}

const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 60;
const COLUMN_WIDTH_PADDING = 2;

/** Real column width per column index, derived from the actual longest value (header or any row's cell) present in that column -- never a fixed guess, never dependent on knowing specific column names. An entry in `widthOverrides` (if provided) wins outright for that column index, skipping the content scan entirely. Exported for direct, focused unit testing of the width-clamping rules. */
export function computeColumnWidths(headers: readonly string[], rows: readonly (readonly string[])[], widthOverrides?: readonly (number | undefined)[]): number[] {
  return headers.map((header, colIndex) => {
    const override = widthOverrides?.[colIndex];
    if (override !== undefined) return override;
    let maxLength = header.length;
    for (const row of rows) {
      const value = row[colIndex];
      if (value && value.length > maxLength) maxLength = value.length;
    }
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, maxLength + COLUMN_WIDTH_PADDING));
  });
}

export function buildXlsxWorkbook(sheets: readonly XlsxSheetInput[]): Buffer {
  if (sheets.length === 0) throw new Error("buildXlsxWorkbook() requires at least one sheet.");
  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(buildContentTypesXml(sheets.length), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS_XML, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(buildWorkbookXml(sheets.map((s) => s.name)), "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(buildWorkbookRelsXml(sheets.length), "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(STYLES_XML, "utf8") },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: Buffer.from(buildSheetXml(sheet.headers, sheet.rows, computeColumnWidths(sheet.headers, sheet.rows, sheet.columnWidths), sheet.wrapTextColumns ?? []), "utf8"),
    })),
  ];
  return buildZip(entries);
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converts a 0-based column index into its spreadsheet column letter(s) (0 -> "A", 16 -> "Q", 26 -> "AA", ...). Exported so other callers needing A1-notation column letters (e.g. spreadsheet-google-sheets-writeback.ts's real range construction) reuse this single, tested implementation rather than a second one. */
export function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Style indexes into xl/styles.xml's cellXfs -- 0 is the plain default, 1 is bold (header row only), 2 is wrap-text (data cells in a `wrapTextColumns` column). */
const HEADER_STYLE_INDEX = 1;
const WRAP_TEXT_STYLE_INDEX = 2;

function buildSheetXml(headers: readonly string[], rows: readonly (readonly string[])[], columnWidths: readonly number[], wrapTextColumns: readonly number[]): string {
  const allRows = [headers, ...rows];
  const wrapColumnSet = new Set(wrapTextColumns);
  const rowXmls = allRows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const isHeaderRow = rowIndex === 0;
      const cellXmls = row
        .map((value, colIndex) => {
          const ref = `${columnIndexToLetter(colIndex)}${rowNumber}`;
          // The header row is always bold, never wrapped -- wrap-text applies only to DATA cells in a
          // designated column, so long content wraps within that cell instead of spilling horizontally.
          const styleIndex = isHeaderRow ? HEADER_STYLE_INDEX : wrapColumnSet.has(colIndex) ? WRAP_TEXT_STYLE_INDEX : null;
          const styleAttr = styleIndex === null ? "" : ` s="${styleIndex}"`;
          if (value === "") return `<c r="${ref}"${styleAttr}/>`;
          return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cellXmls}</row>`;
    })
    .join("");
  const colsXml = columnWidths.length === 0 ? "" : `<cols>${columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`;
  // Freezes the header row (pane split after row 1) so it stays visible while scrolling through a long,
  // real prospect list -- the standard OOXML mechanism every major spreadsheet app reads.
  const sheetViewsXml =
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    sheetViewsXml +
    colsXml +
    "<sheetData>" +
    rowXmls +
    "</sheetData></worksheet>"
  );
}

function buildWorkbookXml(sheetNames: readonly string[]): string {
  const sheetEntries = sheetNames.map((name, index) => `<sheet name="${escapeXmlText(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheetEntries}</sheets></workbook>`
  );
}

function buildWorkbookRelsXml(sheetCount: number): string {
  const relationships = Array.from({ length: sheetCount }, (_, index) => {
    const n = index + 1;
    return `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`;
  }).join("");
  const stylesRel = `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}${stylesRel}</Relationships>`;
}

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

/**
 * Minimal styles part: cellXfs index 0 is the plain default; index 1 is bold -- used only for the header
 * row (see HEADER_STYLE_INDEX above), giving the header a real, visually distinct, non-overlapping
 * presentation consistent with a normal spreadsheet export; index 2 is wrap-text + top vertical alignment
 * -- used only for a designated column's DATA cells (see WRAP_TEXT_STYLE_INDEX above), so a long value
 * (e.g. a full page URL with a long path/query string) wraps onto multiple lines WITHIN its own fixed-width
 * cell instead of ever visually overflowing into a neighboring column.
 */
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
  "</cellXfs>" +
  "</styleSheet>";

function buildContentTypesXml(sheetCount: number): string {
  const overrides = Array.from(
    { length: sheetCount },
    (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    overrides +
    "</Types>"
  );
}

// ---------------------------------------------------------------------------------------------------
// Minimal ZIP writer -- the counterpart to spreadsheet-reader.ts's own minimal ZIP reader.
// ---------------------------------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + entry.data.length;
  }
  const centralDirStart = offset;
  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, eocd]);
}
