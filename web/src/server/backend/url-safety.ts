import path from "node:path";
import { fileURLToPath } from "node:url";

// Thin delegator to the canonical SSRF-guard implementation at
// src/core/crawling/url-safety.ts (compiled to dist/src/core/crawling/
// url-safety.js by the root build). Kept as a real module here (rather than
// removed) so existing imports (`@/server/backend/url-safety`) keep working
// unchanged -- but the actual blocked-range logic now lives in exactly one
// place instead of being duplicated between the root backend and this web
// app.

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");

let modulePromise: Promise<{ assertPublicHttpUrl: (rawUrl: string) => Promise<URL> }> | null = null;

async function getModule() {
  if (!modulePromise) {
    modulePromise = import(/* webpackIgnore: true */ `file://${path.join(backendDist, "core/crawling/url-safety.js")}`);
  }
  return modulePromise;
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  const { assertPublicHttpUrl: canonical } = await getModule();
  return canonical(rawUrl);
}
