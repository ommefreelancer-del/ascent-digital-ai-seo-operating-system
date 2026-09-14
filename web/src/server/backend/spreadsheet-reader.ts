// LOCAL, ZERO-DEPENDENCY SPREADSHEET READER (2026-09-02): reads the real bytes of an already-uploaded,
// ownership-checked Attachment (see attachments.ts's retrieveAttachmentFile()) entirely in-process --
// never sends file bytes to Anthropic/Gemini/any external service, never fetches anything over the
// network. XLSX is a ZIP container of XML parts; this implements a minimal ZIP reader (End Of Central
// Directory + Central Directory parsing, DEFLATE via Node's built-in zlib.inflateRawSync -- the same
// raw-deflate format ZIP uses) and a focused, regex-based extraction of just the spreadsheetML pieces
// needed here (sheet names/order, the shared-string table, and each worksheet's row/cell values) --
// intentionally not a general-purpose XML DOM parser, since spreadsheetML's own structure for this is
// regular enough for targeted extraction. CSV uses a standard quoted-field state-machine parser. No
// external npm package is used or required -- this build has no network access to install one, and a
// from-scratch reader for these two formats is well within a "smallest safe fix" scope. Legacy binary
// XLS (OLE2/BIFF8) is NOT implemented here -- that format needs a real binary compound-file parser, which
// is a materially larger undertaking than "smallest safe fix" and would otherwise require an external
// dependency this environment cannot install without network access; readSpreadsheet() honestly reports
// XLS as unsupported rather than fabricating partial support.

import { inflateRawSync } from "node:zlib";

export interface SpreadsheetSheet {
  readonly name: string;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly rows: readonly (readonly string[])[];
}

export interface SpreadsheetReadResult {
  readonly ok: boolean;
  readonly sheetNames?: readonly string[];
  readonly sheets?: readonly SpreadsheetSheet[];
  /** Set only when ok:false -- a real, specific reason, never generic. */
  readonly error?: string;
}

export interface DuplicateRowGroup {
  /** 0-based indexes into the sheet's own data rows (excluding the header row). */
  readonly rowIndexes: readonly number[];
  readonly values: readonly string[];
}

// ---------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------

/** Standard RFC 4180-style quoted-field state machine -- handles embedded commas/newlines/escaped quotes and both CRLF and bare LF line endings. */
function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  const allRows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      field = "";
      allRows.push(row);
      row = [];
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    allRows.push(row);
  }
  const nonBlankRows = allRows.filter((r) => r.some((cell) => cell.trim() !== ""));
  const headers = nonBlankRows[0] ?? [];
  const dataRows = nonBlankRows.slice(1);
  return { headers, rows: dataRows };
}

function readCsv(buffer: Buffer): SpreadsheetReadResult {
  const text = buffer.toString("utf8");
  if (text.trim().length === 0) {
    return { ok: false, error: "This CSV file is empty." };
  }
  const { headers, rows } = parseCsvText(text);
  return { ok: true, sheetNames: ["Sheet1"], sheets: [{ name: "Sheet1", headers, rowCount: rows.length, rows }] };
}

// ---------------------------------------------------------------------------------------------------
// Minimal ZIP reader (just enough to open an XLSX container)
// ---------------------------------------------------------------------------------------------------

interface ZipEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const MIN_EOCD_SIZE = 22;
const MAX_ZIP_COMMENT_SIZE = 65535;

function findEndOfCentralDirectory(buf: Buffer): number {
  const searchStart = Math.max(0, buf.length - MIN_EOCD_SIZE - MAX_ZIP_COMMENT_SIZE);
  for (let i = buf.length - MIN_EOCD_SIZE; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("This does not look like a valid XLSX file (not a real ZIP container).");
}

function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("This XLSX file's internal ZIP structure is corrupt (bad central directory entry).");
    }
    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const fileNameLength = buf.readUInt16LE(offset + 28);
    const extraFieldLength = buf.readUInt16LE(offset + 30);
    const fileCommentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
}

function extractZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const localFileNameLength = buf.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraFieldLength = buf.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
  const compressedData = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(compressedData);
  if (entry.compressionMethod === 8) return inflateRawSync(compressedData);
  throw new Error(`This XLSX file uses an unsupported internal compression method (${entry.compressionMethod}).`);
}

// ---------------------------------------------------------------------------------------------------
// Minimal spreadsheetML (XLSX's internal XML) extraction -- targeted regex parsing, not a general XML DOM
// ---------------------------------------------------------------------------------------------------

function unescapeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml))) {
    const inner = siMatch[1]!;
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let text = "";
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(inner))) {
      text += unescapeXmlEntities(tMatch[1]!);
    }
    strings.push(text);
  }
  return strings;
}

function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseWorksheetXml(xml: string, sharedStrings: readonly string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml))) {
    const rowXml = rowMatch[1]!;
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    const cells: { col: number; value: string }[] = [];
    let cellMatch: RegExpExecArray | null;
    let implicitCol = 0;
    while ((cellMatch = cellRegex.exec(rowXml))) {
      const attrs = cellMatch[1]!;
      const content = cellMatch[2] ?? "";
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const typeMatch = /t="([^"]+)"/.exec(attrs);
      const type = typeMatch ? typeMatch[1] : null;
      const colIndex = refMatch ? columnLetterToIndex(refMatch[1]!) : implicitCol;
      implicitCol = colIndex + 1;

      let value = "";
      if (type === "s") {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(content);
        const idx = vMatch ? Number.parseInt(vMatch[1]!, 10) : NaN;
        value = Number.isFinite(idx) ? (sharedStrings[idx] ?? "") : "";
      } else if (type === "inlineStr") {
        const tMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(content);
        value = tMatch ? unescapeXmlEntities(tMatch[1]!) : "";
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(content);
        value = vMatch ? unescapeXmlEntities(vMatch[1]!) : "";
      }
      cells.push({ col: colIndex, value });
    }
    if (cells.length === 0) {
      rows.push([]);
      continue;
    }
    const maxCol = Math.max(...cells.map((c) => c.col));
    const rowArray: string[] = new Array(maxCol + 1).fill("");
    for (const cell of cells) rowArray[cell.col] = cell.value;
    rows.push(rowArray);
  }
  return rows;
}

function parseWorkbookSheetList(xml: string): { name: string; rId: string }[] {
  const sheets: { name: string; rId: string }[] = [];
  const sheetRegex = /<sheet\b([^>]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = sheetRegex.exec(xml))) {
    const attrs = m[1]!;
    const nameMatch = /name="([^"]*)"/.exec(attrs);
    const ridMatch = /r:id="([^"]*)"/.exec(attrs);
    if (nameMatch && ridMatch) {
      sheets.push({ name: unescapeXmlEntities(nameMatch[1]!), rId: ridMatch[1]! });
    }
  }
  return sheets;
}

function parseWorkbookRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const relRegex = /<Relationship\b([^>]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = relRegex.exec(xml))) {
    const attrs = m[1]!;
    const idMatch = /Id="([^"]*)"/.exec(attrs);
    const targetMatch = /Target="([^"]*)"/.exec(attrs);
    if (idMatch && targetMatch) map.set(idMatch[1]!, targetMatch[1]!);
  }
  return map;
}

function readXlsx(buffer: Buffer): SpreadsheetReadResult {
  let entries: ZipEntry[];
  try {
    entries = readZipEntries(buffer);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read this file as a valid XLSX workbook." };
  }
  const byName = new Map(entries.map((e) => [e.name, e]));

  const workbookEntry = byName.get("xl/workbook.xml");
  const relsEntry = byName.get("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relsEntry) {
    return { ok: false, error: "This file does not look like a valid XLSX workbook (missing required internal structure)." };
  }

  let workbookXml: string;
  let relsXml: string;
  try {
    workbookXml = extractZipEntry(buffer, workbookEntry).toString("utf8");
    relsXml = extractZipEntry(buffer, relsEntry).toString("utf8");
  } catch (error) {
    return { ok: false, error: `Could not decompress this XLSX file: ${error instanceof Error ? error.message : String(error)}` };
  }

  let sharedStrings: string[] = [];
  const sharedStringsEntry = byName.get("xl/sharedStrings.xml");
  if (sharedStringsEntry) {
    try {
      sharedStrings = parseSharedStrings(extractZipEntry(buffer, sharedStringsEntry).toString("utf8"));
    } catch {
      sharedStrings = [];
    }
  }

  const sheetDefs = parseWorkbookSheetList(workbookXml);
  if (sheetDefs.length === 0) {
    return { ok: false, error: "This XLSX workbook has no readable worksheets." };
  }
  const relMap = parseWorkbookRels(relsXml);

  const sheets: SpreadsheetSheet[] = [];
  for (const def of sheetDefs) {
    const target = relMap.get(def.rId);
    if (!target) continue;
    const normalizedTarget = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheetEntry = byName.get(normalizedTarget) ?? byName.get(target);
    if (!sheetEntry) continue;

    let sheetXml: string;
    try {
      sheetXml = extractZipEntry(buffer, sheetEntry).toString("utf8");
    } catch {
      continue;
    }
    const allRows = parseWorksheetXml(sheetXml, sharedStrings);
    const headers = allRows[0] ?? [];
    const dataRows = allRows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ""));
    sheets.push({ name: def.name, headers, rowCount: dataRows.length, rows: dataRows });
  }

  if (sheets.length === 0) {
    return { ok: false, error: "Could not read any worksheet contents from this XLSX file." };
  }
  return { ok: true, sheetNames: sheets.map((s) => s.name), sheets };
}

// ---------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------

/** Reads a real, already-retrieved attachment buffer locally -- never over the network, never sent to any external/AI service. `fileType` is the same normalized type attachments.ts already tracks (xlsx/xls/csv/pdf/docx). */
export function readSpreadsheet(buffer: Buffer, fileType: string): SpreadsheetReadResult {
  if (fileType === "csv") return readCsv(buffer);
  if (fileType === "xlsx") return readXlsx(buffer);
  return {
    ok: false,
    error:
      `The ${fileType.toUpperCase()} format cannot be read for its contents in this build. ` +
      (fileType === "xls"
        ? "Legacy XLS (the pre-2007 binary Excel format) requires a binary OLE2/BIFF parser this build does not include -- please re-save/export the file as XLSX or CSV and re-attach it."
        : "Only XLSX and CSV can currently be parsed locally."),
  };
}

/** Exact-duplicate detection: two data rows are duplicates when every cell (trimmed) is identical, in order. Deterministic -- the same input always produces the same grouping, never a fuzzy/approximate match. */
export function findExactDuplicateRows(rows: readonly (readonly string[])[]): DuplicateRowGroup[] {
  const seen = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = JSON.stringify(row.map((cell) => cell.trim()));
    const existing = seen.get(key);
    if (existing) existing.push(index);
    else seen.set(key, [index]);
  });
  const duplicateGroups: DuplicateRowGroup[] = [];
  for (const [key, rowIndexes] of seen) {
    if (rowIndexes.length > 1) {
      duplicateGroups.push({ rowIndexes, values: JSON.parse(key) as string[] });
    }
  }
  return duplicateGroups;
}
