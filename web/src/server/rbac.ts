// PHASE 2 PRODUCTION SECURITY & GOVERNANCE FIX: a real, enforced role/
// permission model for ADASOS. Before this, User.role existed as a real
// database column (prisma/schema.prisma, default "owner") but was never
// read by any authorization check anywhere in this codebase -- confirmed by
// direct grep across web/src during this fix's own investigation (the only
// prior reader was admin-governance.ts's own read-only report, which
// surfaced this exact gap). This module is the single source of truth for
// which roles exist and what each may do; assertAuthorized() is the one
// function every sensitive-action enforcement point calls.
//
// ARCHITECTURAL SCOPE (deliberately NOT a multi-tenant sharing model): this
// codebase's real data model has no Organization/Team/Workspace-with-
// multiple-members concept -- every User row already IS its own fully
// isolated tenant (see prisma/schema.prisma's own per-model client-
// isolation comments: every sensitive model is scoped by a single owning
// userId/workspaceId, with no sharing mechanism between accounts). There is
// no existing "invite a teammate" flow anywhere in web/src (confirmed by
// grep for invite/team member/organization/workspace member/seat -- the
// only hits were unrelated: the user's own company-name field and GitHub's
// own "user/organization" account-type terminology). Building a full
// multi-user permission-sharing model here would be exactly the system
// rebuild this task explicitly forbids. Instead, `role` is enforced as a
// real, meaningful CAPABILITY LEVEL for what the account itself may do to
// its own data -- a genuinely real production need (a read-only
// stakeholder/reporting login, credentials scoped to view-only for a junior
// team member using the same account) -- never a cross-account sharing
// model, and CLIENT ISOLATION (which account owns which data) is completely
// unaffected by this and remains enforced exactly as before, purely by
// userId/workspaceId scoping.
//
// ROLES:
//   "owner"  (schema default) -- full access: may approve/reject
//            RemediationApproval decisions (the one real, already-
//            established production-affecting-change gate in this
//            codebase -- see remediation.ts's own header on why a human
//            decision here is the sole point a real repository write ever
//            proceeds from).
//   "viewer" -- read-only: may view audits, reports, dashboards, and
//            governance evidence, but is DENIED any production-affecting
//            decision.
//
// FAIL CLOSED: an unknown/malformed role value (defensive -- the schema
// column is a plain String, not a DB-level enum/CHECK constraint) is
// treated as the LEAST privileged real role ("viewer"), never the most
// privileged -- a corrupted or unexpected value can never silently grant
// owner-level access.

import { db } from "./db";
import { logActivity } from "./log-activity";

export type Role = "owner" | "viewer";
const KNOWN_ROLES: ReadonlySet<string> = new Set<Role>(["owner", "viewer"]);

/** Fail-closed: anything other than a real, known role string normalizes to the least-privileged role. */
export function normalizeRole(rawRole: string | null | undefined): Role {
  return rawRole && KNOWN_ROLES.has(rawRole) ? (rawRole as Role) : "viewer";
}

export type Capability = "approveRemediation" | "rejectRemediation";

const ROLE_CAPABILITIES: Readonly<Record<Role, ReadonlySet<Capability>>> = {
  owner: new Set<Capability>(["approveRemediation", "rejectRemediation"]),
  viewer: new Set<Capability>(),
};

export interface AuthorizationCheck {
  readonly authorized: boolean;
  readonly role: Role;
}

/**
 * Real, DB-backed authorization check -- fetches the account's actual
 * current role (never trusts a caller-supplied value) and checks it against
 * the real capability matrix above. Never throws for a missing user; that
 * normalizes to the fail-closed "viewer" role like any other unknown value.
 */
export async function checkAuthorization(userId: string, capability: Capability): Promise<AuthorizationCheck> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  const role = normalizeRole(user?.role);
  return { authorized: ROLE_CAPABILITIES[role].has(capability), role };
}

export type AuthorizationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Enforces `capability` for `userId`. On denial, logs a real, auditable
 * ActivityEvent (category "authorization") so a denied attempt is never
 * silent -- requirement 5 (authorization failures are logged/auditable).
 * Returns this codebase's existing `{ ok: false, error }` shape (see
 * remediation.ts's own RemediationApprovalResolution) rather than
 * introducing a new error type or throwing, so every existing caller's
 * error-handling path already knows how to surface this honestly.
 */
export async function assertAuthorized(userId: string, capability: Capability): Promise<AuthorizationResult> {
  const { authorized, role } = await checkAuthorization(userId, capability);
  if (authorized) {
    return { ok: true };
  }
  await logActivity(userId, "authorization", `Authorization denied: role "${role}" is not permitted to perform "${capability}".`).catch(() => undefined);
  return { ok: false, error: `Your account role ("${role}") does not have permission to perform this action.` };
}
