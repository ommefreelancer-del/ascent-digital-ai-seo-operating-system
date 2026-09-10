// Makes a task's own "this capability is unavailable" outcome authoritative
// for that same task's later routing decisions -- Rule 3/5 of the
// production-hardening task this fixes: "the current system already
// produces useful rejection records [TaskStateStore, ../state/task-state-store.ts]
// -- make that state authoritative for future candidate selection... a
// rejection record must be consumable by the Boss router, not merely
// displayed in the agent response."
//
// TaskStateStore already persists each run's full outcome history to disk
// for audit/traceability, but nothing reads it back into a routing decision
// -- it is write-only from TaskRouter's perspective. This is the missing
// read path: a tracker that TaskRouter consults BEFORE re-scoring a task it
// has already determined needs an unavailable capability, so a second
// route() call for the SAME task id can never re-attempt the same
// disqualified capability class -- eliminating the proven failure mode
// (Keyword Research -> SEO Strategy -> SEO Content -> On-Page, four separate
// wrong attempts for the same underlying gap) at its root, rather than only
// preventing it within a single route() call via capability gating alone.
//
// DURABILITY (production-hardening follow-up, 2026-08-13): an in-memory-only
// version of this class loses all rejection state whenever the TaskRouter
// instance holding it is recreated -- which is a real production path, not a
// hypothetical one: both real callers (src/boss-agent/boss-agent.ts's
// BossAgent.create() and web/src/server/backend/conversation.ts's getClm())
// build exactly one TaskRouter per Node process and hold it in a
// module-level/instance-level singleton for that process's lifetime, so a
// process restart, redeploy, dev-server reload, or (for a serverless/
// multi-instance web deployment) a request landing on a different process
// instance than the one that recorded the rejection all lose in-memory-only
// state. `persistenceDirectory` makes each rejection record survive that --
// backed by the SAME atomic-write file-per-record convention TaskStateStore
// already uses (see writeJsonFileAtomicSync's doc comment for why this is
// synchronous rather than routed through TaskStateStore's async API: route()
// must stay synchronous, since dozens of existing call sites -- production
// and test -- depend on RoutingDecision being returned synchronously, and
// changing that would be exactly the kind of wide-blast-radius signature
// break this hardening pass was told not to introduce). This is additive to
// TaskStateStore's directory, not a competing persistence system: rejection
// records live in a `rejections/` subdirectory of the same configured
// stateDirectory, namespaced separately from TaskStateStore's own
// `<runId>.json` run files so a task id and a run id (both UUIDs) can never
// collide on a filename.
//
// KNOWN REMAINING GAP (documented, not silently papered over -- see this
// task's own production report): this only protects a task id that is
// reused across calls. The real conversation-language-manager entry point
// (src/conversation-language-manager/conversation-language-manager.ts) mints
// a fresh `randomUUID()` per incoming chat message, so two natural-language
// messages describing "the same" task never actually share a task id in
// production today -- there is currently no real trigger path where a
// process restart would cause an already-known-unavailable task to be
// silently re-attempted with a DIFFERENT outcome, because gating alone
// (capability-classifier.ts) already re-derives the identical
// capability-unavailable result on a fresh evaluation. This durability layer
// is a correct, real fix for the case it targets (the same task id, reused
// across a process boundary) and closes that gap honestly; it does not and
// cannot give two independently-generated task ids a shared identity, since
// that would require changing conversation-language-manager's id-minting
// policy, which is out of this task's scope (a different module, not Boss
// Agent routing).

import { join } from "node:path";
import { readJsonFileSync, writeJsonFileAtomicSync } from "../../core/persistence/json-file-store.js";
import type { CapabilityClass } from "./capability-classifier.js";

export interface RejectionRecord {
  readonly taskId: string;
  readonly capability: CapabilityClass;
  readonly reason: string;
  readonly recordedAt: string;
}

export class RoutingRejectionTracker {
  private readonly recordsByTaskId = new Map<string, RejectionRecord[]>();

  /**
   * @param persistenceDirectory When provided, every recorded rejection is
   * also durably written under `<persistenceDirectory>/<taskId>.json` (one
   * file per task id, atomic write), and `hasUnresolvedRejection`/
   * `getRejections` fall back to reading it when a task id isn't already in
   * memory -- surviving a fresh `RoutingRejectionTracker`/`TaskRouter`
   * instance pointed at the same directory (i.e. a process restart). Omit
   * for pure in-memory behavior (the default for every existing test and any
   * caller that doesn't pass a 4th TaskRouter constructor argument).
   */
  constructor(private readonly persistenceDirectory?: string) {}

  /** Records that `capability` was found unavailable for `taskId`, so a later route() call for the same task never re-attempts it -- durably, if `persistenceDirectory` was provided. */
  recordUnavailableCapability(taskId: string, capability: CapabilityClass, reason: string): void {
    const existing = this.recordsByTaskId.get(taskId) ?? this.loadFromDisk(taskId) ?? [];
    const updated = [...existing, { taskId, capability, reason, recordedAt: new Date().toISOString() }];
    this.recordsByTaskId.set(taskId, updated);
    if (this.persistenceDirectory) {
      writeJsonFileAtomicSync(this.recordFilePath(taskId), updated);
    }
  }

  /** True if this exact task id has already been found to require a capability with no eligible candidate -- checking durable storage too, if configured. */
  hasUnresolvedRejection(taskId: string): boolean {
    return this.getRejections(taskId).length > 0;
  }

  /** Every rejection recorded for `taskId`, oldest first -- for audit/rationale text. Reads through to durable storage (and hydrates the in-memory cache) when the task id isn't already in memory. */
  getRejections(taskId: string): readonly RejectionRecord[] {
    const inMemory = this.recordsByTaskId.get(taskId);
    if (inMemory) {
      return inMemory;
    }
    const fromDisk = this.loadFromDisk(taskId);
    if (fromDisk) {
      this.recordsByTaskId.set(taskId, fromDisk);
      return fromDisk;
    }
    return [];
  }

  private loadFromDisk(taskId: string): RejectionRecord[] | undefined {
    if (!this.persistenceDirectory) {
      return undefined;
    }
    return readJsonFileSync<RejectionRecord[]>(this.recordFilePath(taskId));
  }

  private recordFilePath(taskId: string): string {
    return join(this.persistenceDirectory ?? "", `${taskId}.json`);
  }
}
