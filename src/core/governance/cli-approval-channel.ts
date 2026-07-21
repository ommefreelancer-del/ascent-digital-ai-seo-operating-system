// Concrete ApprovalChannel that asks a human directly on the terminal. This
// is the approval mechanism chosen for this build: execution blocks and a
// real yes/no-style decision is read from stdin before the Boss Agent
// finalizes an uncertain routing decision.

import { createInterface } from "node:readline/promises";
import type { ApprovalChannel } from "./approval-channel.js";
import type { ApprovalDecision, ApprovalRequest } from "../types/approval.types.js";

export class CliApprovalChannel implements ApprovalChannel {
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;

  constructor(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout,
  ) {
    this.input = input;
    this.output = output;
  }

  async requestDecision(request: ApprovalRequest): Promise<ApprovalDecision> {
    const rl = createInterface({ input: this.input, output: this.output });
    try {
      this.printRequest(request);
      const selection = await this.promptForSelection(rl, request);
      const decidedAt = new Date().toISOString();

      if (selection === "reject") {
        const notes = await rl.question("Reason for rejecting this task (optional): ");
        return {
          requestId: request.id,
          outcome: "rejected",
          notes: notes.trim() || "Rejected by human reviewer.",
          decidedAt,
        };
      }

      const chosen = request.candidates[selection];
      if (!chosen) {
        // Defensive: promptForSelection already validates the index, so this
        // would only happen if the candidate list changed underneath us.
        throw new Error("Selected candidate index is no longer valid.");
      }
      const notes = await rl.question("Notes to record with this decision (optional): ");
      return {
        requestId: request.id,
        outcome: "candidate_selected",
        selectedCandidateId: chosen.id,
        notes: notes.trim() || `Human-confirmed assignment to "${chosen.label}".`,
        decidedAt,
      };
    } finally {
      rl.close();
    }
  }

  private printRequest(request: ApprovalRequest): void {
    this.output.write(`\n--- Human decision required (${request.reason}) ---\n`);
    this.output.write(`${request.summary}\n\n`);
    if (request.candidates.length === 0) {
      this.output.write("No candidate agents were found for this task.\n");
    } else {
      request.candidates.forEach((candidate, index) => {
        this.output.write(
          `  [${index}] ${candidate.label}  (score: ${candidate.score.toFixed(2)})\n` +
            `      ${candidate.rationale}\n`,
        );
      });
    }
    this.output.write(`  [reject] Do not assign this task to any agent\n\n`);
  }

  private async promptForSelection(
    rl: ReturnType<typeof createInterface>,
    request: ApprovalRequest,
  ): Promise<number | "reject"> {
    for (;;) {
      const answer = (await rl.question("Enter a candidate index, or \"reject\": ")).trim().toLowerCase();
      if (answer === "reject") {
        return "reject";
      }
      if (request.candidates.length === 0) {
        this.output.write("No candidates are available; you must enter \"reject\".\n");
        continue;
      }
      const index = Number.parseInt(answer, 10);
      if (Number.isInteger(index) && index >= 0 && index < request.candidates.length) {
        return index;
      }
      this.output.write(
        `Please enter a number between 0 and ${request.candidates.length - 1}, or "reject".\n`,
      );
    }
  }
}
