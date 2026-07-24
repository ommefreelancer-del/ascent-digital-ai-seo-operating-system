// Drafts a meta title and meta description for a content brief. This is a
// deterministic template tied to the brief's real target keyword and
// classified intent, with a bracketed placeholder for the brand name --
// the same convention OnPageSeoAgent's TitleMetaRecommender already uses
// for the same reason (this agent has no way to know a real brand name
// unless brandGuidelines supplies one). Never a final, ready-to-publish
// rewrite -- no LLM is used to produce this.

import type { SearchIntent } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { ContentBrief } from "../../content-strategy-agent/types/content-strategy-request.types.js";
import { capitalize } from "../util/capitalize.js";

function brandToken(brandGuidelines: string | null): string {
  return brandGuidelines ? "[Your Brand -- see supplied brand guidelines]" : "[Your Brand]";
}

function draftMetaTitle(keyword: string, intent: SearchIntent, brandGuidelines: string | null): string {
  const term = capitalize(keyword);
  const brand = brandToken(brandGuidelines);
  switch (intent) {
    case "transactional":
      return `Buy ${term} | ${brand}`;
    case "commercial":
      return `Best ${term}: Comparison Guide | ${brand}`;
    case "navigational":
      return `${term} | ${brand} Official Page`;
    case "informational":
    default:
      return `${term}: The Complete Guide | ${brand}`;
  }
}

function draftMetaDescription(keyword: string, intent: SearchIntent): string {
  const term = keyword;
  switch (intent) {
    case "transactional":
      return `Shop ${term} today. [Add your unique value proposition -- pricing, shipping, or guarantees.]`;
    case "commercial":
      return `Compare the best options for ${term}. [Add what makes your recommendation trustworthy.]`;
    case "navigational":
      return `Official information about ${term}. [Add what a visitor will find here.]`;
    case "informational":
    default:
      return `Learn everything about ${term} in this complete guide. [Add your specific angle or expertise.]`;
  }
}

export interface MetaContentDraft {
  readonly metaTitle: string;
  readonly metaDescription: string;
}

export class MetaContentBuilder {
  build(brief: ContentBrief, brandGuidelines: string | null): MetaContentDraft {
    return {
      metaTitle: draftMetaTitle(brief.targetKeyword, brief.intent, brandGuidelines),
      metaDescription: draftMetaDescription(brief.targetKeyword, brief.intent),
    };
  }
}
