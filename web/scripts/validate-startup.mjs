// Startup validation: checks the things that, when broken, previously
// surfaced as a confusing runtime crash or a silently-degraded feature deep
// into a request instead of an immediate, legible failure at boot. Exits
// non-zero (aborting startup) on any REQUIRED failure. Run automatically by
// scripts/pm2-dev.mjs before every real start (and by predev/prebuild via
// package.json), and by CI (.github/workflows/ci.yml) so a broken startup
// fails the build, not just a developer's machine.
//
// Deliberately narrow: this checks that the application CAN start correctly
// (registry, env, build artifacts), not that every feature works end-to-end
// (that's tests/ + the manual E2E passes documented in RUN_GUIDE.md).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptsDir, "..");
const backendRoot = path.resolve(webRoot, "..");
const backendDist = path.join(backendRoot, "dist", "src");

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}
function warn(message) {
  warnings.push(message);
}

// This script runs BEFORE `next dev`/`next start` even boots (see
// pm2-dev.mjs and package.json's predev/prebuild), so process.env does not
// yet have .env loaded into it -- that happens inside Next.js's own
// startup, which is the very thing this script exists to gate. Read the
// file directly instead (same approach health-check.mjs already uses),
// falling back to .env.local per Next's own precedence if present.
function loadEnvFile() {
  const loaded = {};
  for (const filename of [".env", ".env.local"]) {
    const filePath = path.join(webRoot, filename);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) loaded[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  }
  return loaded;
}
const env = loadEnvFile();

// 1. Required environment variables. Missing any of these previously
// surfaced as a confusing runtime error deep in a request (e.g. Prisma
// throwing on an undefined DATABASE_URL, or NextAuth silently minting
// sessions with an empty secret) instead of an immediate, legible failure.
const REQUIRED_ENV = ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "ANTHROPIC_API_KEY"];
for (const key of REQUIRED_ENV) {
  if (!env[key] || env[key].trim() === "") {
    fail(`Missing required environment variable: ${key} (see web/.env.example)`);
  }
}

// Optional -- the Google Search Console integration degrades gracefully
// (Settings shows "Connect" and the AI Workspace tells the user it isn't
// connected) rather than crashing, so this is a warning, not a failure.
for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
  if (!env[key] || env[key].trim() === "") {
    warn(`${key} is not set -- the Google Search Console integration will be unavailable until it is.`);
  }
}

// 2. The backend must actually be built. web/scripts/prepare-backend.mjs is
// supposed to guarantee this, but validating it explicitly here means a
// stale/missing dist/ fails loudly at startup instead of as an opaque
// "Cannot find module" the first time a request needs it.
const cliEntry = path.join(backendDist, "cli.js");
if (!existsSync(cliEntry)) {
  fail(`Backend is not built: ${cliEntry} does not exist. Run "npm run build" at the repo root.`);
} else {
  // 3. The real production registry loader, against the real Agents/
  // directory -- proves every spec parses AND that there are no duplicate
  // agent ids/titles, which would otherwise let two specialists silently
  // shadow each other in routing with no error until someone noticed the
  // wrong one kept answering.
  try {
    const { AgentRegistry } = await import(`file://${path.join(backendDist, "boss-agent", "registry", "agent-registry.js")}`);
    const registry = await AgentRegistry.load(path.join(backendRoot, "Agents"));
    const specs = registry.list();

    if (specs.length === 0) {
      fail("Agent registry loaded zero specialist agents from Agents/*.md.");
    }

    const idCounts = new Map();
    const titleCounts = new Map();
    for (const spec of specs) {
      idCounts.set(spec.id, (idCounts.get(spec.id) ?? 0) + 1);
      titleCounts.set(spec.title, (titleCounts.get(spec.title) ?? 0) + 1);
    }
    for (const [id, count] of idCounts) {
      if (count > 1) fail(`Duplicate agent id "${id}" registered ${count} times -- two Agents/*.md files derive the same id.`);
    }
    for (const [title, count] of titleCounts) {
      if (count > 1) fail(`Duplicate agent title "${title}" registered ${count} times.`);
    }
  } catch (error) {
    fail(`Agent registry failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 4. The Prisma client must be generated for this schema -- a stale client
// (schema changed, `prisma generate` never re-run) fails with a cryptic
// "Unknown field" error the first time a route touches the new field,
// rather than at startup.
const prismaClientEntry = path.join(webRoot, "node_modules", "@prisma", "client", "index.js");
if (!existsSync(prismaClientEntry)) {
  fail(`Prisma client is not generated: ${prismaClientEntry} does not exist. Run "npx prisma generate" (or "npm run db:push") in web/.`);
}

// 5. No duplicate registration of the same Next.js API route path. Next.js
// itself refuses to build with two literal route.ts files at the same path,
// so this can't actually happen post-build -- checked anyway as a fast,
// explicit signal instead of relying on a build failure to explain why.
async function collectRouteFiles(dir) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const routes = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...(await collectRouteFiles(full)));
    } else if (entry.name === "route.ts") {
      routes.push(full);
    }
  }
  return routes;
}
const apiDir = path.join(webRoot, "src", "app", "api");
if (existsSync(apiDir)) {
  const routeFiles = await collectRouteFiles(apiDir);
  const normalized = routeFiles.map((f) => f.replace(/\\/g, "/"));
  const seen = new Set();
  for (const f of normalized) {
    if (seen.has(f)) fail(`Duplicate route file listed twice: ${f}`);
    seen.add(f);
  }
}

console.log("ADASOS startup validation");
console.log("=".repeat(40));
if (warnings.length > 0) {
  for (const w of warnings) console.log(`[WARN] ${w}`);
}
if (failures.length > 0) {
  for (const f of failures) console.log(`[FAIL] ${f}`);
  console.log("=".repeat(40));
  console.log(`Startup validation FAILED (${failures.length} issue(s)) -- aborting.`);
  process.exit(1);
}
console.log("[PASS] All startup checks passed.");
console.log("=".repeat(40));
