// Structural validation for an incoming AiCrmRequest. This agent makes no
// approve/reject judgment call -- like the Campaign Tracking Agent, it only
// aggregates real, already-computed data and real, caller-supplied client
// information into reports and proposed record updates -- so it has no
// low-confidence or policy-risk signal to check. Only a genuine structural
// problem (a blank field in a supplied client info entry) throws, per
// GLOBAL_RULES.md SS11.

import type { AiCrmRequest } from "../types/ai-crm-request.types.js";

export class AiCrmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiCrmValidationError";
  }
}

export class AiCrmRequestValidator {
  /** Throws AiCrmValidationError if the request is structurally invalid. */
  validate(request: AiCrmRequest): void {
    for (const client of request.clientInfo ?? []) {
      if (!client.clientName.trim()) {
        throw new AiCrmValidationError("Every clientInfo entry must have a non-empty clientName.");
      }
      if (!client.status.trim()) {
        throw new AiCrmValidationError(`clientInfo entry for "${client.clientName}" must have a non-empty status.`);
      }
      if (!client.lastContactedAt.trim()) {
        throw new AiCrmValidationError(`clientInfo entry for "${client.clientName}" must have a non-empty lastContactedAt.`);
      }
    }
  }
}
