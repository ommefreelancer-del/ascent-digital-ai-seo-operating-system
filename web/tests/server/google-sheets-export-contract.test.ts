// GOOGLE SHEETS EXPORT CONTRACT (2026-09-15): real, live-confirmed production incident -- on 2026-09-13
// at 11:13:22/11:14:08 (see web/.pm2/error.log), spreadsheet-google-sheets-writeback.ts and
// spreadsheet-cleaning-actions.ts imported appendSpreadsheetValues/assertSheetsWriteScope/
// ensureSheetExists/quoteSheetName/getWriteDestinationSpreadsheet from @/server/google-sheets while that
// file did not yet export all of them (mid-edit). Next.js's dev compiler crash-looped the whole
// PM2-managed process on this -- an "Attempted import error" is not scoped to the one broken route, it
// took down the entire `next dev` process, and every concurrent request (including the browser's
// NextAuth SessionProvider polling /api/auth/session on every mount) failed at the network level with
// "Failed to fetch" -- the exact [next-auth][error][CLIENT_FETCH_ERROR] shown in the browser. The export
// surface is correct again now (verified), but nothing previously caught this class of mismatch except
// an actual dev-server crash. This is a fast, source-level, no-DB/no-network check that fails immediately
// -- before `next dev` ever needs to compile the broken chain -- if any file under src/ imports a name
// from "@/server/google-sheets" that the module doesn't actually export.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(__dirname, "../../src");
const GOOGLE_SHEETS_SOURCE_PATH = path.resolve(__dirname, "../../src/server/google-sheets.ts");

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function extractExportedNames(source: string): Set<string> {
  const names = new Set<string>();
  const pattern = /^export\s+(?:async\s+)?(?:function|const|class|interface)\s+([A-Za-z_$][\w$]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    names.add(match[1]!);
  }
  return names;
}

/** Parses `import { a, type b, c as d } from "@/server/google-sheets";` -- returns the LOCAL bound names
 * on the left of any `as`, since that's what the export set must contain (a `type` prefix is stripped;
 * type-only imports still need a real matching export -- google-sheets.ts exports its types the same way
 * as its runtime values, via `export interface`). */
function extractImportedNames(importClause: string): string[] {
  return importClause
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim());
}

describe("every import from @/server/google-sheets resolves to a real export (root cause of the 2026-09-13 CLIENT_FETCH_ERROR crash-loop)", () => {
  const exportedNames = extractExportedNames(readFileSync(GOOGLE_SHEETS_SOURCE_PATH, "utf8"));
  const sourceFiles = collectSourceFiles(SRC_ROOT).filter((f) => f !== GOOGLE_SHEETS_SOURCE_PATH);

  it("google-sheets.ts itself exports at least the known real surface (sanity check the extractor works)", () => {
    expect(exportedNames.has("getSelectedSpreadsheet")).toBe(true);
    expect(exportedNames.has("getAllSpreadsheetValues")).toBe(true);
    expect(exportedNames.has("getWriteDestinationSpreadsheet")).toBe(true);
  });

  it("no file under src/ imports a name from \"@/server/google-sheets\" that isn't actually exported", () => {
    const problems: string[] = [];
    const importPattern = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@\/server\/google-sheets["']/g;

    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      let match: RegExpExecArray | null;
      while ((match = importPattern.exec(content)) !== null) {
        for (const name of extractImportedNames(match[1]!)) {
          if (!exportedNames.has(name)) {
            problems.push(`${path.relative(SRC_ROOT, file)}: imports "${name}", which @/server/google-sheets.ts does not export`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
