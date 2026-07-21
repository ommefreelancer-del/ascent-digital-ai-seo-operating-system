// Writes structured audit records to an append-only JSON-lines file.
// Implements GLOBAL_RULES.md SS10 (Audit Trail & Logging): every task
// received, routing decision, escalation, and compliance failure is recorded
// so the run can be reconstructed and reviewed after the fact.

import { randomUUID } from "node:crypto";
import { JsonlAppender } from "../persistence/jsonl-appender.js";
import type { AuditEvent, AuditEventInput } from "../types/audit-event.types.js";

export class AuditLogger {
  private readonly appender: JsonlAppender;

  constructor(filePath: string) {
    this.appender = new JsonlAppender(filePath);
  }

  async logEvent(input: AuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...input,
    };
    await this.appender.append(event);
    return event;
  }
}
