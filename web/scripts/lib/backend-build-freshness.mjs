// Pure, dependency-free staleness check for the ADASOS backend's compiled
// output (../../dist relative to the backend root), extracted out of
// prepare-backend.mjs so it can be exercised directly by a real regression
// test (web/tests/scripts/backend-build-freshness.test.ts) against real
// temp-directory files and mtimes -- no mocks, and no duplicated logic
// between the script and its test.
//
// Real production incident this exists to prevent (2026-08-14): several
// backend/src files were added/changed, `npm run build` was never re-run at
// the repo root afterward, and the OLD check here ("does dist/src/cli.js
// exist at all?") kept saying "already built" forever after the first build,
// because it never compared source freshness against dist -- so the web
// app's runtime kept resolving a stale dist/ that was missing a compiled
// file entirely, surfacing as "Cannot find module ...dist/src/boss-agent/
// routing/routing-rejection-tracker.js" deep inside a live request.
//
// `tsc -p tsconfig.json` (see ../../../tsconfig.json) has no
// "incremental"/"composite" option set, so a full build always rewrites
// every emitted file's mtime -- that is what makes "compare the newest
// source .ts mtime against one known dist output file's mtime" a valid,
// simple freshness proxy without needing to hash or diff every file.

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** The newest mtime (ms) among every `${srcDir}/**\/*.ts` file, or -Infinity if none exist. */
export function newestTypeScriptMtimeMs(srcDir) {
  let newest = -Infinity;
  for (const entryName of readdirSync(srcDir, { recursive: true })) {
    if (!entryName.endsWith(".ts")) continue;
    const mtimeMs = statSync(path.join(srcDir, entryName)).mtimeMs;
    if (mtimeMs > newest) newest = mtimeMs;
  }
  return newest;
}

/**
 * True if `backendRoot`'s compiled output is missing entirely, or any
 * `${backendRoot}/src/**\/*.ts` file is newer than
 * `${backendRoot}/dist/src/cli.js` (the build's own freshness proxy --
 * see this file's header comment).
 */
export function isBackendDistStale(backendRoot) {
  const distEntry = path.join(backendRoot, "dist", "src", "cli.js");
  if (!existsSync(distEntry)) {
    return true;
  }
  const distMtimeMs = statSync(distEntry).mtimeMs;
  const sourceMtimeMs = newestTypeScriptMtimeMs(path.join(backendRoot, "src"));
  return sourceMtimeMs > distMtimeMs;
}
