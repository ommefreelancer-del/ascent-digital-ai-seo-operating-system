// Structural validation for an incoming ClientRelationshipManagementRequest.
// Every real, caller-supplied financial record must have a non-empty
// clientName and a non-negative amount where one applies -- a negative
// quotation or invoice amount is a data-entry error to report, never
// silently accept, per GLOBAL_RULES.md SS11.

import type { ClientRelationshipManagementRequest } from "../types/client-relationship-management-request.types.js";

export class ClientRelationshipManagementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientRelationshipManagementValidationError";
  }
}

export class ClientRelationshipManagementRequestValidator {
  validate(request: ClientRelationshipManagementRequest): void {
    for (const quotation of request.quotations ?? []) {
      if (!quotation.clientName.trim()) {
        throw new ClientRelationshipManagementValidationError("Every quotation entry must have a non-empty clientName.");
      }
      if (quotation.amount < 0) {
        throw new ClientRelationshipManagementValidationError(`Quotation for "${quotation.clientName}" must not have a negative amount.`);
      }
    }
    for (const contract of request.contracts ?? []) {
      if (!contract.clientName.trim()) {
        throw new ClientRelationshipManagementValidationError("Every contract entry must have a non-empty clientName.");
      }
    }
    for (const invoice of request.invoices ?? []) {
      if (!invoice.clientName.trim()) {
        throw new ClientRelationshipManagementValidationError("Every invoice entry must have a non-empty clientName.");
      }
      if (invoice.amount < 0) {
        throw new ClientRelationshipManagementValidationError(`Invoice for "${invoice.clientName}" must not have a negative amount.`);
      }
    }
  }
}
