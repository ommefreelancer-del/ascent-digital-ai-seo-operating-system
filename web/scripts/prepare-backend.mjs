// Ensures the frozen ADASOS backend (../src) is compiled to ../dist before
// this app starts/builds, since the server-side adapter layer
// (src/server/backend/*) imports the compiled agent classes directly by
// relative path. Never modifies or rebuilds backend *source* -- this only
// (re)runs the backend's own existing `npm run build` script.
//
// STALENESS CHECK (2026-08-14): this used to skip the rebuild whenever
// ../dist/src/cli.js merely EXISTED, with no check that it was still current.
// A real production incident: several ../src files were added/changed in a
// session (capability-classifier.ts, routing-rejection-tracker.ts,
// task-router.ts's new imports of both), `npm run build` was never re-run at
// the repo root afterward, and this script's existence-only check kept
// skipping the rebuild on every subsequent `next dev`/`next build` because
// cli.js from the OLD build was still sitting there -- so the web app's
// runtime kept resolving a stale ../dist that was missing the two new
// compiled files entirely, surfacing as "Cannot find module
// .../dist/src/boss-agent/routing/routing-rejection-tracker.js" the first
// time a real request exercised that import path, well after `tsc --noEmit`
// (typecheck only, never writes ../dist) had already been run and passed
// repeatedly. `tsc -p tsconfig.json` (this project's build, see
// ../../tsconfig.json) has no "incremental"/"composite" option set, so a
// full build always rewrites every emitted file's mtime -- checked here as a
// simple, dependency-free freshness proxy: if any ../src/**/*.ts file is
// newer than ../dist/src/cli.js, the dist tree is stale and gets rebuilt.
// This mirrors, at build time, what validate-startup.mjs (run right after
// this script) now also verifies at startup time by actually importing the
// real module graph a request would need -- two layers, not one, since a
// developer or CI environment could still delete/corrupt ../dist between
// this script running and the app actually starting.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isBackendDistStale } from "./lib/backend-build-freshness.mjs";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendRoot = path.resolve(webRoot, "..");

if (!isBackendDistStale(backendRoot)) {
  console.log("[prepare-backend] ../dist is already built and up to date with ../src, skipping.");
  process.exit(0);
}

console.log("[prepare-backend] Building the ADASOS backend (../) so the web app can import its compiled agents (missing, or ../src has changed since the last build)...");

// PRODUCTION INCIDENT (2026-09-08, PM2 error log): PM2's daemon spawned this
// script with an inherited PATH that did not resolve `npm` at all (Windows,
// PM2 running as a background/service-like process rather than an
// interactive shell) -- `spawnSync("npm", ...)` failed instantly with
// "'npm' is not recognized...", 8 times back to back within 5 seconds,
// burning through pm2-dev.mjs's whole restart budget before `next dev` ever
// got a chance to start. Exactly the same class of problem pm2-dev.mjs
// already solved for `next dev` itself (see that file's own header comment)
// -- so apply the same fix here: invoke the backend's build tool (tsc, per
// its own package.json "build" script) as a plain JS entry point via this
// exact node.exe (`process.execPath`), never through npm/cmd, so a missing
// or PATH-stripped `npm` can no longer break this step.
const tscBin = path.join(backendRoot, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json"], {
  cwd: backendRoot,
  stdio: "inherit",
});

if (result.status !== 0) {
  console.error("[prepare-backend] Backend build failed -- see output above.");
  process.exit(result.status ?? 1);
}
