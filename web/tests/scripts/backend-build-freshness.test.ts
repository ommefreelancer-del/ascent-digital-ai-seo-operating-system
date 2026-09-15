// Real regression test for the production incident where `npm run build`
// was never re-run at the repo root after backend/src changed, and
// prepare-backend.mjs's OLD existence-only check ("does dist/src/cli.js
// exist?") kept saying "already built" forever -- so the web app's runtime
// resolved a stale dist/ missing a compiled module entirely, surfacing as
// "Cannot find module .../dist/src/boss-agent/routing/routing-rejection-tracker.js"
// deep inside a live request. This exercises the REAL freshness function
// prepare-backend.mjs actually uses (imported directly, not duplicated),
// against REAL files and REAL mtimes in a temp directory -- no mocks.

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBackendDistStale, newestTypeScriptMtimeMs } from "../../scripts/lib/backend-build-freshness.mjs";

describe("isBackendDistStale (real files, real mtimes, no mocks)", () => {
  let backendRoot: string;

  beforeEach(() => {
    backendRoot = mkdtempSync(join(tmpdir(), "backend-freshness-"));
    mkdirSync(join(backendRoot, "src", "boss-agent", "routing"), { recursive: true });
    mkdirSync(join(backendRoot, "dist", "src"), { recursive: true });
    writeFileSync(join(backendRoot, "src", "boss-agent", "routing", "task-router.ts"), "// source", "utf8");
  });

  afterEach(() => {
    rmSync(backendRoot, { recursive: true, force: true });
  });

  function setMtime(filePath: string, whenMs: number): void {
    const date = new Date(whenMs);
    utimesSync(filePath, date, date);
  }

  it("is stale when dist/src/cli.js does not exist at all", () => {
    expect(isBackendDistStale(backendRoot)).toBe(true);
  });

  it("is NOT stale when dist/src/cli.js is newer than every source file (the real production incident's missing check)", () => {
    const sourceFile = join(backendRoot, "src", "boss-agent", "routing", "task-router.ts");
    const distFile = join(backendRoot, "dist", "src", "cli.js");
    writeFileSync(distFile, "// compiled", "utf8");
    setMtime(sourceFile, 1_000_000);
    setMtime(distFile, 2_000_000);

    expect(isBackendDistStale(backendRoot)).toBe(false);
  });

  it("IS stale when a source file was modified after dist/src/cli.js was last built -- the exact real incident", () => {
    const sourceFile = join(backendRoot, "src", "boss-agent", "routing", "task-router.ts");
    const distFile = join(backendRoot, "dist", "src", "cli.js");
    writeFileSync(distFile, "// compiled (stale)", "utf8");
    setMtime(distFile, 1_000_000);
    setMtime(sourceFile, 2_000_000); // source changed AFTER the last build

    expect(isBackendDistStale(backendRoot)).toBe(true);
  });

  it("detects staleness from a NEW source file added after the last build, even if older files weren't touched", () => {
    const distFile = join(backendRoot, "dist", "src", "cli.js");
    const oldSourceFile = join(backendRoot, "src", "boss-agent", "routing", "task-router.ts");
    writeFileSync(distFile, "// compiled", "utf8");
    setMtime(oldSourceFile, 1_000_000);
    setMtime(distFile, 2_000_000);

    // The real incident: a brand-new file (routing-rejection-tracker.ts)
    // created after the last build, while other source files stayed old.
    const newSourceFile = join(backendRoot, "src", "boss-agent", "routing", "routing-rejection-tracker.ts");
    writeFileSync(newSourceFile, "// new source, never compiled", "utf8");
    setMtime(newSourceFile, 3_000_000);

    expect(isBackendDistStale(backendRoot)).toBe(true);
  });

  it("newestTypeScriptMtimeMs ignores non-.ts files", () => {
    const srcDir = join(backendRoot, "src");
    const tsFile = join(srcDir, "boss-agent", "routing", "task-router.ts");
    const jsonFile = join(srcDir, "boss-agent", "routing", "notes.json");
    writeFileSync(jsonFile, "{}", "utf8");
    setMtime(tsFile, 1_000_000);
    setMtime(jsonFile, 5_000_000); // newer, but not a .ts file -- must be ignored

    expect(newestTypeScriptMtimeMs(srcDir)).toBe(1_000_000);
  });
});
