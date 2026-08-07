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
const result = spawnSync("npm", ["run", "build"], {
  cwd: backendRoot,
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  console.error("[prepare-backend] Backend build failed -- see output above.");
  process.exit(result.status ?? 1);
}
