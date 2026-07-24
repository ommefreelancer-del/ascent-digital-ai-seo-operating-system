// Builds the natural-language reply presented to the user -- per the
// architecture doc's "Receives final responses. Presents responses
// naturally to the user" responsibility. Every reply describes only the
// real RoutingDecision the Boss Agent actually produced (assigned /
// escalated / rejected); this module never fabricates what a specialist
// agent would have done, since no specialist agent is executed as part of
// producing a RoutingDecision (see src/boss-agent/boss-agent.ts). Two real,
// authored template sets exist (English and Urdu) -- this is honest,
// labeled templating, never machine translation.

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";
import type { SupportedLanguage } from "../types/conversation.types.js";

export class ReplyTemplateBuilder {
  clarification(language: SupportedLanguage): string {
    return language === "ur"
      ? "براہ کرم مزید تفصیل فراہم کریں تاکہ میں آپ کی درست رہنمائی کر سکوں۔"
      : "Could you share a bit more detail so I can route this accurately?";
  }

  routing(decision: RoutingDecision, language: SupportedLanguage): string {
    if (decision.status === "assigned") {
      return language === "ur"
        ? `یہ درخواست "${decision.assignedAgentId}" کو بھیج دی گئی ہے۔ وجہ: ${decision.rationale}`
        : `This has been routed to "${decision.assignedAgentId}" for handling. ${decision.rationale}`;
    }
    if (decision.status === "escalated") {
      return language === "ur"
        ? `آگے بڑھنے سے پہلے اس درخواست کا جائزہ ایک انسانی نگران کو لینا ہوگا۔ وجہ: ${decision.rationale}`
        : `This request needs human review before it can proceed. ${decision.rationale}`;
    }
    return language === "ur"
      ? `یہ درخواست کسی بھی ایجنٹ کو تفویض نہیں کی گئی۔ وجہ: ${decision.rationale}`
      : `This request was not assigned to any agent. ${decision.rationale}`;
  }
}
