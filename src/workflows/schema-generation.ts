// Deterministic Schema.org JSON-LD generation shared by seo-audit-workflow.ts
// and blog-generation-workflow.ts. Populated only from fields the caller
// actually knows (title, target keyword, content type); anything this
// workflow genuinely cannot know (author, publish date) gets an explicit
// bracketed placeholder, never an invented value -- the same convention
// OnPageSeoAgent's TitleMetaRecommender already uses for on-page copy.

export interface ArticleSchemaInput {
  readonly title: string;
  readonly targetKeyword: string;
  readonly contentType: string;
}

export function generateArticleSchema(input: ArticleSchemaInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": input.contentType === "pillar" || input.contentType === "blog-post" ? "BlogPosting" : "Article",
    headline: input.title,
    keywords: input.targetKeyword,
    author: "[REPLACE: author name]",
    datePublished: "[REPLACE: publish date, ISO 8601]",
  };
}
