// Shape of one entry in the append-only audit log. GLOBAL_RULES.md SS10
// (Audit Trail & Logging) requires that important actions be traceable for
// transparency, accountability, and troubleshooting. Kept generic (not
// Boss-Agent-specific) so any future agent can write to the same log format.

/** A single, immutable record of something the system did or decided. */
export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly eventType: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** Fields the caller supplies; id/timestamp are assigned by the logger. */
export type AuditEventInput = Omit<AuditEvent, "id" | "timestamp">;
