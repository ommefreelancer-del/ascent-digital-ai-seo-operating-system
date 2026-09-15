// Runtime capability resolution for the Prospecting Agent's real
// guest-post/SERP discovery provider -- the "capability registry" chain
// this module exists to close: DataForSEO connection -> SERP Live Advanced
// capability -> Prospecting Discovery capability -> Prospecting Agent, all
// one real, traceable path.
//
// Follows the exact same lazy-singleton dynamic-import convention every
// other real-provider connection in this adapter layer uses (see
// getLighthouseProvider() in ./website-audit.ts, getDataForSeoBacklinkDataProvider()
// in ./off-page-seo.ts): dynamically imports the compiled, frozen backend
// class from ../../../../dist so it reads its own real credentials from
// process.env, exactly as documented in
// src/agents/prospecting-agent/providers/dataforseo-guest-post-discovery-provider.ts.
//
// The critical property this module adds: resolveProspectDiscoveryProvider()
// decides WHICH class to instantiate using @/server/dataforseo's
// getSerpCapabilityStatus() -- the exact same function
// web/src/app/(app)/settings/page.tsx passes to Settings -> Integrations.
// There is no second, independently-derived "is this capability ready"
// check anywhere -- UI and runtime read the same boolean logic, so they can
// never disagree about whether the real capability is available. When it
// is NOT genuinely ready (not configured, Sandbox-only, or production not
// explicitly opted in), this falls back to NullProspectDiscoveryProvider --
// the same safe, honest "unavailable" default every other agent in this
// codebase uses -- never a silent partial/fabricated capability.
//
// No workspace-scoped state: DataForSEO is a single, server-side credential
// pair (not a per-user OAuth connection, see server/dataforseo.ts's own
// header), so there is nothing to isolate per workspace here -- every call
// re-reads the same process-wide capability status and constructs a fresh,
// stateless provider instance; no cross-request/cross-user caching of
// discovery results happens in this module.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSerpCapabilityStatus } from "@/server/dataforseo";
import { createWebApprovalChannel } from "./approval";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

export interface ProspectDiscoveryProviderLike {
  readonly name: string;
  discoverProspects(request: unknown): Promise<unknown>;
}

interface ProviderClasses {
  readonly DataForSeoGuestPostDiscoveryProvider: new () => ProspectDiscoveryProviderLike;
  readonly NullProspectDiscoveryProvider: new () => ProspectDiscoveryProviderLike;
}

let classesPromise: Promise<ProviderClasses> | null = null;

async function loadProviderClasses(): Promise<ProviderClasses> {
  if (!classesPromise) {
    classesPromise = (async () => {
      const [realModule, nullModule] = await Promise.all([
        importBackend("agents/prospecting-agent/providers/dataforseo-guest-post-discovery-provider.js"),
        importBackend("agents/prospecting-agent/providers/null-prospect-discovery-provider.js"),
      ]);
      return {
        DataForSeoGuestPostDiscoveryProvider: realModule.DataForSeoGuestPostDiscoveryProvider,
        NullProspectDiscoveryProvider: nullModule.NullProspectDiscoveryProvider,
      };
    })();
  }
  return classesPromise;
}

/**
 * Resolves the SAME real capability Settings -> Integrations reports for
 * DataForSEO SERP / Guest Posting Discovery. Real, billed
 * DataForSeoGuestPostDiscoveryProvider only when getSerpCapabilityStatus()
 * reports `ready: true` (configured, non-Sandbox, explicit
 * DATAFORSEO_SERP_ALLOW_PRODUCTION opt-in); NullProspectDiscoveryProvider
 * -- the genuine "unavailable" fallback -- otherwise. Never fabricates
 * availability: this is the one real code path a caller (or a test) can use
 * to prove which provider the live Prospecting Agent would actually
 * receive right now.
 */
export async function resolveProspectDiscoveryProvider(): Promise<ProspectDiscoveryProviderLike> {
  const status = getSerpCapabilityStatus();
  const { DataForSeoGuestPostDiscoveryProvider, NullProspectDiscoveryProvider } = await loadProviderClasses();
  return status.ready ? new DataForSeoGuestPostDiscoveryProvider() : new NullProspectDiscoveryProvider();
}

// -- Real chat dispatch (2026-08-16 routing fix) -----------------------
//
// Closes the second half of the "Prospecting Agent isn't real" defect:
// routing alone was not enough -- web/src/app/api/workspace/messages/route.ts's
// dispatch chain only ever called REAL tools for exactly two agent ids
// (website-audit-agent, seo-content-agent -- see capability-classifier.ts's
// own "CAPABILITY-REGISTRY VS. REAL EXECUTION" comment); every other
// assigned agent, prospecting-agent included, fell through to the generic,
// tool-less Claude role-play fallback. runProspecting() is the real,
// chat-dispatch-wired execution path route.ts now calls for
// assignedAgentId === "prospecting-agent" -- constructs the real
// ProspectingAgent (frozen backend), wired to resolveProspectDiscoveryProvider()
// above, so it receives the SAME real-or-Null provider Settings ->
// Integrations reports.

export interface ProspectSummary {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly category: string;
  readonly confidence: string;
  readonly notes: string;
  readonly evidenceUrl?: string;
  readonly evidenceSnippet?: string;
  readonly verified?: boolean;
  readonly contactEmail?: string | null;
  readonly source?: string;
  readonly retrievedAt?: string;
  /** SUPPLIED-URL INVESTIGATION FEATURE (2026-09-08): the real page this prospect's contact email was actually found on -- may differ from evidenceUrl (e.g. contact found on a separate "Contact" page). Absent for a SERP-discovered prospect. */
  readonly contactSourceUrl?: string | null;
  /** SUPPLIED-URL INVESTIGATION FEATURE (2026-09-08): the most recent, independently verifiable published article found -- every field a real value from the source page's own declarations, `null` when genuinely not found. Absent (not merely `null`) for a SERP-discovered prospect. */
  readonly latestArticle?: {
    readonly title: string;
    readonly url: string;
    readonly publicationDate: string | null;
    readonly author: string | null;
    readonly sourceUrl: string;
  } | null;
}

export interface ProspectingRunResult {
  readonly dataAvailable: boolean;
  readonly prospects: readonly ProspectSummary[];
  readonly duplicatesRemoved: number;
  readonly limitations: readonly string[];
  readonly providerName: string;
  /** `null` when this run was a supplied-URL investigation (see `investigatedUrl` instead) rather than niche-based discovery. */
  readonly niche: string | null;
  /** SUPPLIED-URL INVESTIGATION FEATURE (2026-09-08): the real, user-supplied URL this run investigated, or `null` when this was an ordinary niche-discovery run. */
  readonly investigatedUrl: string | null;
  /** True when the real agent's own low-confidence/thin-result escalation was rejected (never auto-approved -- see web/src/server/backend/approval.ts's NEVER_AUTO_RESOLVE_REASONS) rather than proceeding with a weak list. */
  readonly rejected: boolean;
  readonly rejectionNotes: string | null;
}

interface UrlInvestigationRunResult {
  readonly dataAvailable: boolean;
  readonly prospects: readonly ProspectSummary[];
  readonly duplicatesRemoved: number;
  readonly limitations: readonly string[];
}

interface ProspectingAgentClass {
  create(
    config: { auditLogPath: string },
    provider: ProspectDiscoveryProviderLike,
    approvalChannel: unknown,
  ): Promise<{
    discoverProspects(request: Record<string, unknown>): Promise<ProspectingRunResult & { prospects: readonly ProspectSummary[] }>;
    /** SUPPLIED-URL INVESTIGATION FEATURE (2026-09-08): investigates ONE specific, supplied URL -- see src/agents/prospecting-agent/processing/url-investigator.ts. Uses the real UrlInvestigator default (free page fetching, no external paid dependency) -- never requires a discovery provider to be configured. */
    investigateUrl(request: { id: string; url: string; campaignRequirements?: string }): Promise<UrlInvestigationRunResult>;
  }>;
}

let agentClassPromise: Promise<ProspectingAgentClass> | null = null;

async function loadProspectingAgentClass(): Promise<ProspectingAgentClass> {
  if (!agentClassPromise) {
    agentClassPromise = (async () => {
      const mod = await importBackend("agents/prospecting-agent/prospecting-agent.js");
      return mod.ProspectingAgent as ProspectingAgentClass;
    })();
  }
  return agentClassPromise;
}

/**
 * Small, disclosed heuristic -- extracts a short niche phrase from freeform
 * chat text for the real DataForSEO query (ProspectDiscoveryRequest.targetNiche
 * must be non-empty). Never invents a niche: falls back to a broad, honestly
 * generic default when no specific phrase is found, rather than guessing.
 *
 * NICHE-EXTRACTION FIX (2026-08-22): a real, live-reproduced defect -- a
 * genuine guest-posting request naturally often begins with a capitalized
 * action verb ("Find guest posting opportunities for a project management
 * SaaS company in the productivity software niche."). NICHE_BEFORE_GUEST_POST
 * was checked FIRST and matches "one to three capitalized words immediately
 * before 'guest post(ing)'" -- with no other candidate word in front of
 * "guest posting", it matched the sentence's own leading "Find" and returned
 * that as the niche, even though the SAME message also explicitly states
 * the real niche via "in the ... niche". The fix is ordering, not new
 * heuristics: an explicit "in/for the X niche" phrase is a far more
 * deliberate, unambiguous signal than "capitalized word(s) happen to sit
 * next to guest post(ing)", so it is now checked FIRST -- NICHE_BEFORE_GUEST_POST
 * still exists, unchanged, as the last-resort fallback for messages that
 * never say "niche" at all (e.g. "Looking for Fintech guest posting
 * opportunities.").
 */
const NICHE_IN_OR_FOR_THE_X_NICHE = /\b(?:in|for) the ([A-Za-z][A-Za-z/&\- ]{1,40}?) niche\b/i;
const NICHE_BEFORE_NICHE_WORD = /((?:[A-Z][\w/&-]*\s+){0,2}[A-Z][\w/&-]*)\s+niche/;
const NICHE_BEFORE_GUEST_POST = /((?:[A-Z][\w/&-]*\s+){0,2}[A-Z][\w/&-]*)\s+guest[- ]post(?:ing)?/;
const NICHE_PATTERNS: readonly RegExp[] = [NICHE_IN_OR_FOR_THE_X_NICHE, NICHE_BEFORE_NICHE_WORD, NICHE_BEFORE_GUEST_POST];
const DEFAULT_NICHE = "general guest-posting opportunities";

export function extractNiche(message: string): string {
  for (const pattern of NICHE_PATTERNS) {
    const candidate = message.match(pattern)?.[1]?.trim();
    if (candidate) return candidate;
  }
  return DEFAULT_NICHE;
}

// SUPPLIED-URL INVESTIGATION FEATURE (2026-09-08): a real, user-supplied URL in the message means "go
// investigate THIS specific site" (ProspectingAgent.investigateUrl()), never "extract a niche phrase and
// run a generic SERP search" -- see this file's own header and url-investigator.ts for the real fetch/
// extract chain. Mirrors the SAME URL-detection shape already used elsewhere in this codebase
// (web/src/app/api/workspace/messages/route.ts's own extractUrl()) -- kept as its own small, local copy
// rather than importing a route-file-local function, matching this codebase's own established convention
// of a few independent copies of this simple pattern (also present in
// src/boss-agent/routing/tag-weighted-routing-strategy.ts and prospecting-intent-detector.ts).
const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/i;

export function extractSuppliedUrl(message: string): string | null {
  const match = message.match(URL_PATTERN);
  return match ? match[0].replace(/[.,;:]+$/, "") : null;
}

/**
 * Real dispatch: resolves the real-or-Null discovery provider, constructs the real ProspectingAgent, and
 * runs a genuine pass against the chat message -- a supplied-URL INVESTIGATION (investigateUrl(), real
 * page fetching, no external paid dependency, no discovery provider required) when the message names a
 * real URL, otherwise the existing niche-based DISCOVERY pass (discoverProspects(), the real DataForSEO
 * SERP provider when configured). Never fabricates a result -- a genuinely thin/empty result (or the
 * agent's own low-confidence escalation, now never auto-resolved -- see approval.ts) is reported honestly
 * via `rejected`/`dataAvailable` rather than papered over.
 */
export async function runProspecting(message: string): Promise<ProspectingRunResult> {
  const provider = await resolveProspectDiscoveryProvider();
  const ProspectingAgent = await loadProspectingAgentClass();

  const agent = await ProspectingAgent.create(
    { auditLogPath: path.join(backendRoot, "var", "web", "prospecting", "audit-log.jsonl") },
    provider,
    createWebApprovalChannel(),
  );

  const suppliedUrl = extractSuppliedUrl(message);
  if (suppliedUrl) {
    try {
      const result = await agent.investigateUrl({ id: randomUUID(), url: suppliedUrl, campaignRequirements: message });
      return {
        dataAvailable: result.dataAvailable,
        prospects: result.prospects,
        duplicatesRemoved: result.duplicatesRemoved,
        limitations: result.limitations,
        providerName: "url-investigation",
        niche: null,
        investigatedUrl: suppliedUrl,
        rejected: false,
        rejectionNotes: null,
      };
    } catch (error) {
      return {
        dataAvailable: false,
        prospects: [],
        duplicatesRemoved: 0,
        limitations: [],
        providerName: "url-investigation",
        niche: null,
        investigatedUrl: suppliedUrl,
        rejected: true,
        rejectionNotes: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const niche = extractNiche(message);
  const request = {
    id: randomUUID(),
    campaignRequirements: message,
    targetNiche: niche,
    // DataForSEO's SERP API needs a single location_name/language_name per
    // call -- no "worldwide" value exists (see
    // dataforseo-guest-post-discovery-provider.ts's own header). United
    // States/English is the broadest reasonable single market for an
    // English-language request; a disclosed choice, not a fabricated one.
    targetCountry: "United States",
    targetLanguage: "English",
  };

  try {
    const result = await agent.discoverProspects(request);
    return {
      dataAvailable: result.dataAvailable,
      prospects: result.prospects,
      duplicatesRemoved: result.duplicatesRemoved,
      limitations: result.limitations,
      providerName: provider.name,
      niche,
      investigatedUrl: null,
      rejected: false,
      rejectionNotes: null,
    };
  } catch (error) {
    return {
      dataAvailable: false,
      prospects: [],
      duplicatesRemoved: 0,
      limitations: [],
      providerName: provider.name,
      niche,
      investigatedUrl: null,
      rejected: true,
      rejectionNotes: error instanceof Error ? error.message : String(error),
    };
  }
}
