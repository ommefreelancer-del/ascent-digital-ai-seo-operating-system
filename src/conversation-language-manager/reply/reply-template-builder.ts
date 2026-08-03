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

  /**
   * For messages about the Boss Agent's own routing/orchestration behavior
   * (see routing/boss-agent-meta-request-detector.ts). Handled directly here
   * rather than routed, since no specialist agent has routing logs,
   * confidence scores, or registry access -- only the Boss Agent does. Does
   * not fabricate specific numbers or logs that aren't actually being
   * surfaced by this reply; points to where real per-request routing detail
   * (candidates considered, matched terms, confidence score) is genuinely
   * shown -- the routing decision returned alongside every task request.
   */
  bossAgentMeta(language: SupportedLanguage): string {
    return language === "ur"
      ? "یہ درخواست Boss Agent کے اپنے routing نظام کے بارے میں معلوم ہوتی ہے، اس لیے میں اسے کسی specialist ایجنٹ کو نہیں بھیج رہا -- کوئی بھی specialist ایجنٹ کے پاس routing logs، confidence scores، یا registry تک رسائی نہیں ہے۔ ہر حقیقی task request کے ساتھ Boss Agent کا اصل routing decision (منتخب کردہ candidates، matched terms، اور confidence score سمیت) اسی جواب میں دکھایا جاتا ہے -- یہاں سے مزید معلومات دیکھی جا سکتی ہیں۔"
      : "This looks like it's about the Boss Agent's own routing system, so I'm handling it directly rather than forwarding it to a specialist agent -- no specialist has routing logs, confidence scores, or registry access. The Boss Agent's real routing decision (candidates considered, matched terms, and confidence score) is shown alongside every actual task request you send; that's where the real routing detail for a specific request lives.";
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
