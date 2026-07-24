// Builds FAQ question stems for a content brief, only when its own real
// recommendedSections outline calls for an FAQ section (never invented
// otherwise). Questions are deterministic templates over the brief's real
// target keyword, related keywords, and classified intent -- answers are
// never fabricated; each item carries a bracketed placeholder instead.

import type { SearchIntent } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { ContentBrief } from "../../content-strategy-agent/types/content-strategy-request.types.js";
import type { FaqItem } from "../types/seo-content-request.types.js";

const FAQ_SECTION_PATTERN = /faq|frequently asked questions/i;

const ANSWER_PLACEHOLDER = "[Provide a factual, EEAT-aligned answer here -- this agent does not fabricate answers.]";

function questionsFor(targetKeyword: string, relatedKeywords: readonly string[], intent: SearchIntent): string[] {
  const questions = [`What is ${targetKeyword}?`, `How does ${targetKeyword} work?`];

  if (intent === "transactional" || intent === "commercial") {
    questions.push(`How much does ${targetKeyword} cost?`);
  }

  const firstRelated = relatedKeywords[0];
  if (firstRelated) {
    questions.push(`How does ${targetKeyword} compare to ${firstRelated}?`);
  }

  return questions;
}

export class FaqBuilder {
  build(brief: ContentBrief): FaqItem[] {
    const hasFaqSection = brief.recommendedSections.some((section) => FAQ_SECTION_PATTERN.test(section));
    if (!hasFaqSection) {
      return [];
    }

    return questionsFor(brief.targetKeyword, brief.relatedKeywords, brief.intent).map((question) => ({
      question,
      answerPlaceholder: ANSWER_PLACEHOLDER,
    }));
  }
}
