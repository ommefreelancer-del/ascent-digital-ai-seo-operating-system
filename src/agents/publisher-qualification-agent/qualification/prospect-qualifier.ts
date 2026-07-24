// Qualifies one real prospect against real evidence only -- per the spec's
// "Review prospect websites", "Check quality against campaign
// requirements", and "Accept or reject prospects" responsibilities, and
// the rule "base decisions on available evidence". Domain authority and
// spam score thresholds are real, documented general industry conventions
// (a spam score above 30 is commonly considered risky; a domain authority
// below 20 is commonly considered too weak for outreach), not a claim
// about a specific client's requirements, consistent with how other agents
// in this codebase state their own thresholds (e.g. Core Web Vitals "good"
// thresholds). Per "forward only qualified prospects": a prospect with no
// real quality evidence behind it is rejected, never assumed acceptable.

import type { Prospect } from "../../prospecting-agent/types/prospecting-request.types.js";
import type { PublisherQualityProvider, PublisherQualitySnapshot } from "../types/publisher-quality-provider.types.js";
import type { QualifiedProspect } from "../types/publisher-qualification-request.types.js";
import { isNicheTextMatch } from "./niche-relevance-checker.js";

const MAX_ACCEPTABLE_SPAM_SCORE = 30;
const MIN_ACCEPTABLE_DOMAIN_AUTHORITY = 20;

export class ProspectQualifier {
  async qualify(
    provider: PublisherQualityProvider,
    prospect: Prospect,
    targetNiche: string,
  ): Promise<{ qualified: QualifiedProspect; quality: PublisherQualitySnapshot | null }> {
    const quality = await provider.fetchPublisherQuality({ domain: prospect.domain, url: prospect.url });
    const nicheTextMatch = isNicheTextMatch(prospect, targetNiche);

    if (!quality) {
      return {
        qualified: {
          url: prospect.url,
          domain: prospect.domain,
          title: prospect.title,
          decision: "rejected",
          notes: "No real publisher quality data is available to verify this prospect; rejected pending real evidence.",
        },
        quality: null,
      };
    }

    const reasons: string[] = [];
    if (!nicheTextMatch && !quality.isNicheRelevant) {
      reasons.push("not confirmed relevant to the target niche");
    }
    if (quality.spamScore > MAX_ACCEPTABLE_SPAM_SCORE) {
      reasons.push(`spam score ${quality.spamScore} exceeds the acceptable threshold of ${MAX_ACCEPTABLE_SPAM_SCORE}`);
    }
    if (quality.domainAuthority < MIN_ACCEPTABLE_DOMAIN_AUTHORITY) {
      reasons.push(`domain authority ${quality.domainAuthority} is below the minimum threshold of ${MIN_ACCEPTABLE_DOMAIN_AUTHORITY}`);
    }

    const qualified: QualifiedProspect =
      reasons.length === 0
        ? {
            url: prospect.url,
            domain: prospect.domain,
            title: prospect.title,
            decision: "approved",
            notes: `Meets quality and relevance criteria (domain authority ${quality.domainAuthority}, spam score ${quality.spamScore}).`,
          }
        : {
            url: prospect.url,
            domain: prospect.domain,
            title: prospect.title,
            decision: "rejected",
            notes: `Rejected: ${reasons.join("; ")}.`,
          };

    return { qualified, quality };
  }
}
