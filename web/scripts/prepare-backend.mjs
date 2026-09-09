// Ensures the frozen ADASOS backend (../src) is compiled to ../dist before
// this app starts/builds, since the server-side adapter layer
// (src/server/backend/*) imports the compiled agent classes directly by
// relative path. Never modifies or rebuilds backend *source* -- this only
// (re)runs the backend's own existing `npm run build` script.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendRoot = path.resolve(webRoot, "..");
const distEntry = path.join(backendRoot, "dist", "src", "cli.js");

if (existsSync(distEntry)) {
  console.log("[prepare-backend] ../dist already built, skipping (delete ../dist to force a rebuild).");
  process.exit(0);
}

console.log("[prepare-backend] Building the ADASOS backend (../) so the web app can import its compiled agents...");

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
