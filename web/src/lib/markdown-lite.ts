// A minimal, dependency-free parser for the small Markdown subset the
// Content Generation prompts actually produce inside a section's body text
// (see src/agents/seo-content-agent/providers/*-content-generation-provider.ts's
// own body-role guidance): a "### " line for a genuine H3 subsection, an
// occasional "#### " line for a genuinely deeper H4 nested under an H3,
// occasional "- "/"* "/"1. " list items when a list genuinely clarifies, and
// -- rarely, only when the prompt's own "only if it genuinely improves
// clarity" guidance judges one warranted -- a real Markdown table. Never a
// general-purpose Markdown renderer -- deliberately scoped to only what this
// codebase's own real prompts ask the model to produce.
//
// LIVE UI VALIDATION FIX (2026-08-29): a real user's live test found the
// Content Generator UI showing no H1/H2/H3 hierarchy at all. Root cause,
// confirmed by reading content-generator-shell.tsx directly: section bodies
// were rendered as one plain <p> with whitespace-pre-wrap, so a real "### "
// heading the model wrote reached the browser as literal "###" characters
// sitting inside a paragraph -- never a real heading element. This parser
// turns that real, already-correct structured text into real block data the
// component can render as actual <h3>/<h4>/<ul>/<ol>/<table>/<p> elements.
//
// RENDERING HARDENING (2026-09-01): a live review found two more real markers
// reaching the reader literally instead of rendering: (1) inline "**bold**"
// text inside an otherwise-real paragraph/list-item/heading, shown as literal
// asterisks (see parseInlineSegments -- applied at render time in
// content-generator-shell.tsx, not here, so block.text stays the exact raw
// string this parser already returned), and (2) a genuine Markdown table
// (the model already only writes one "when it genuinely improves clarity",
// per this agent's own prompt guidance -- the table type below just renders
// one correctly on the rare occasion it appears, instead of each "| a | b |"
// row falling through as its own garbled paragraph).

// BLOG CONTENT GENERATOR DEFECT FIX (2026-09-04): a real, live-observed defect ("Blog #1", target keyword
// "what is guest posting") -- a real, otherwise-good generated section came back with embedded blocks like
// `<!-- Image Suggestion: ALT text: ... SEO Title: ... Meta Description: ... Slug: ... Internal Link
// Suggestion: ... -->` mixed directly into the body text, despite the generation prompt's own "ONLY this
// section's body prose" instruction. src/agents/seo-content-agent/drafting/section-body-sanitizer.ts (the
// frozen backend, which ships no .d.ts -- see this file's own package-boundary convention) now strips this
// at GENERATION time for all new content; this mirrors that same stripping here, at RENDER/DISPLAY time,
// so already-persisted drafts (like Blog #1, saved before this fix existed) display cleanly too, without
// needing to be regenerated through a real, billed provider call just to look right.
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
// REAL, LIVE-OBSERVED DEFECT FIX (2026-09-08): mirrors src/agents/seo-content-agent/drafting/
// section-body-sanitizer.ts's own MARKDOWN_IMAGE_SYNTAX_PATTERN exactly -- a real generation embedded raw
// Markdown image syntax directly in section body prose (e.g. `![A writer researching blogs...]
// (image-placement-1)`). This codebase's real, attached images are rendered as actual <img> elements from
// structured ContentSectionImage data (see content-generator-shell.tsx), never from Markdown syntax inside
// body text -- so `![...](...)` appearing in body text is always contamination, never legitimate content,
// and is always safe to strip regardless of position.
const MARKDOWN_IMAGE_SYNTAX_PATTERN = /!\[[^\]]*\]\([^)]*\)/g;
// REAL, LIVE-OBSERVED DEFECT FIX (2026-09-06, 2026-09-07): mirrors src/agents/seo-content-agent/drafting/
// section-body-sanitizer.ts's own BARE_METADATA_LINE_PATTERN exactly (see that file's own header for the
// real leaked text this closes -- "Filename"/"Purpose" were never in the label list, Markdown decoration
// like "**Image suggestion:**"/"- Alt text:" wasn't tolerated by the old line-start anchor, and a later
// real generation leaked a numbered-list variant using bare "Placement:"/"Concept:" without the "Image "
// prefix).
const BARE_METADATA_LINE_PATTERN =
  /^[ \t]*(?:[-*+]\s+|\d+[.)]\s+)?\*{0,2}(image suggestion|image concept|image placement|filename|purpose|placement|concept|alt(?:[ \t-])?text|seo title|meta description|slug|internal link suggestion|canonical url)\*{0,2}[ \t]*:.*$/gim;

// REAL, LIVE-OBSERVED DEFECT FIX (2026-09-08): mirrors src/agents/seo-content-agent/drafting/
// section-body-sanitizer.ts's own ANYWHERE_METADATA_LABEL_PATTERN exactly (see that file's own header for
// the real leaked INLINE/run-on-paragraph text this closes -- multiple labels compressed into one
// continuous sentence after "Image suggestion:", e.g. "...Placement: ... Concept: ... Filename: ... ALT
// text: ... Purpose: ..." never separated onto their own lines). BARE_METADATA_LINE_PATTERN above only
// matches a label at the START of a line, so this render-time stripper is what actually protects a reader
// viewing an already-persisted draft that contains this shape -- independent of whatever the generation-time
// sanitizer did or didn't do.
const ANYWHERE_METADATA_LABEL_PATTERN =
  /\*{0,2}\b(image suggestions?|image concepts?|image placements?|image recommendations?|alt[ \t-]?text|seo title|meta description|(?:suggested\s+)?slug|internal link suggestions?|canonical url|placement|concept|filename|purpose)\b\*{0,2}[ \t]*:/gi;

const RISKY_METADATA_LABEL_NAMES = new Set(["placement", "concept", "filename", "purpose"]);

interface ParagraphMetadataScan {
  readonly contaminated: boolean;
  readonly earliestIndex: number;
}

// Classifies one paragraph's metadata-label matches by STRUCTURAL SHAPE, not individual words: a single
// occurrence of an inherently-specific label (image suggestion(s)/alt text/seo title/etc.) is enough to
// flag the paragraph on its own; a common-English-word label (placement/concept/filename/purpose) only
// counts once TWO OR MORE distinct ones co-occur in the same paragraph -- so a genuine article that happens
// to use one of these words once, in ordinary prose, is never touched.
function scanParagraphForMetadataRun(paragraph: string): ParagraphMetadataScan {
  const matches = [...paragraph.matchAll(ANYWHERE_METADATA_LABEL_PATTERN)];
  if (matches.length === 0) return { contaminated: false, earliestIndex: -1 };

  const riskyLabelsFound = new Set<string>();
  let hasSafeAnchor = false;
  for (const match of matches) {
    const label = match[1]!.toLowerCase();
    if (RISKY_METADATA_LABEL_NAMES.has(label)) riskyLabelsFound.add(label);
    else hasSafeAnchor = true;
  }

  if (!hasSafeAnchor && riskyLabelsFound.size < 2) return { contaminated: false, earliestIndex: -1 };

  return { contaminated: true, earliestIndex: Math.min(...matches.map((m) => m.index ?? 0)) };
}

/** Strips an inline/run-on-paragraph metadata block -- removes everything in a contaminated paragraph from its earliest metadata label onward, preserving any genuine prose that appeared before it in the same paragraph. Pure, deterministic; never touches a paragraph that doesn't structurally qualify. */
function stripInlineMetadataRuns(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  const cleaned = paragraphs.map((paragraph) => {
    const scan = scanParagraphForMetadataRun(paragraph);
    if (!scan.contaminated) return paragraph;
    return paragraph.slice(0, scan.earliestIndex).trimEnd();
  });
  return cleaned.filter((p) => p.length > 0).join("\n\n");
}

/** Strips embedded supporting-metadata leakage (see this file's own header) from a section's body text before it's parsed/displayed. Pure, deterministic; never alters real prose. */
export function stripSupportingMetadataFromBody(body: string): string {
  let cleaned = body.replace(HTML_COMMENT_PATTERN, "");
  cleaned = cleaned.replace(MARKDOWN_IMAGE_SYNTAX_PATTERN, "");
  cleaned = cleaned.replace(BARE_METADATA_LINE_PATTERN, "");
  cleaned = stripInlineMetadataRuns(cleaned);
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

export type SectionBodyBlock =
  | { readonly type: "heading"; readonly level: 3 | 4; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: "table"; readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] };

// H4 is checked before H3 below -- "#### " also starts with "###", so a naive single check-order
// could misclassify a real H4 line as H3 text with a leftover leading "#". Checking the longer,
// more specific marker first avoids that regardless of pattern definition order.
const H4_PATTERN = /^####\s+(.+)$/;
const H3_PATTERN = /^###\s+(.+)$/;
const UNORDERED_ITEM_PATTERN = /^[-*]\s+(.+)$/;
const ORDERED_ITEM_PATTERN = /^\d+[.)]\s+(.+)$/;
// A genuine table row: starts and ends with "|" and has at least one more "|" between cells.
const TABLE_ROW_PATTERN = /^\|(.+)\|$/;
// The header-separator row a real Markdown table always has directly under its header row --
// cells made only of dashes/colons (e.g. "|---|:---:|---|"). Requiring this immediately after a
// table-row-shaped line is what distinguishes an actual table from an unrelated line that merely
// happens to start and end with "|".
const TABLE_SEPARATOR_PATTERN = /^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|$/;

function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

/**
 * Splits one real line of text (a paragraph, list item, or heading's own text) into plain/bold runs
 * for inline rendering -- never invents text, only reclassifies a real "**bold**" marker the model
 * already wrote into a real bold run instead of leaving the literal asterisks for the reader to see.
 * Kept separate from parseSectionBody's block-level text so existing callers of block.text (e.g. alt
 * text, plain-text exports) keep getting the exact raw string.
 */
export interface InlineSegment {
  readonly text: string;
  readonly bold: boolean;
}

const BOLD_PATTERN = /\*\*(.+?)\*\*/g;

export function parseInlineSegments(text: string): readonly InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(BOLD_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ text: text.slice(lastIndex, index), bold: false });
    segments.push({ text: match[1]!, bold: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), bold: false });
  return segments;
}

/** Parses one section's real body text into real block-level structure -- never invents content, only reclassifies the model's own real text into headings/lists/paragraphs. */
export function parseSectionBody(body: string): SectionBodyBlock[] {
  const lines = stripSupportingMetadataFromBody(body).replace(/\r\n/g, "\n").split("\n");
  const blocks: SectionBodyBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  function flushParagraph(): void {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraphLines = [];
  }

  function flushList(): void {
    if (listItems.length === 0) return;
    blocks.push({ type: "list", ordered: listOrdered, items: [...listItems] });
    listItems = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const h4Match = H4_PATTERN.exec(line);
    if (h4Match) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: 4, text: h4Match[1]!.trim() });
      continue;
    }

    const h3Match = H3_PATTERN.exec(line);
    if (h3Match) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: 3, text: h3Match[1]!.trim() });
      continue;
    }

    // A real table: this line looks like a header row AND the very next line is the required
    // dashes/colons separator row -- that combination is never produced by anything else this parser
    // handles, so it's checked before the list/paragraph fallback to avoid each "| a | b |" row
    // otherwise falling through as its own garbled paragraph.
    const nextLine = lines[i + 1]?.trim();
    if (TABLE_ROW_PATTERN.test(line) && nextLine && TABLE_SEPARATOR_PATTERN.test(nextLine)) {
      flushParagraph();
      flushList();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      i += 2; // skip the header row (already read) and the separator row
      while (i < lines.length && TABLE_ROW_PATTERN.test(lines[i]!.trim())) {
        rows.push(splitTableRow(lines[i]!.trim()));
        i++;
      }
      i--; // the outer for-loop's own increment accounts for the last row line just consumed
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const unorderedMatch = UNORDERED_ITEM_PATTERN.exec(line);
    const orderedMatch = ORDERED_ITEM_PATTERN.exec(line);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const isOrdered = Boolean(orderedMatch);
      if (listItems.length > 0 && listOrdered !== isOrdered) {
        flushList(); // a different list kind starts -- don't merge ordered/unordered items together
      }
      listOrdered = isOrdered;
      listItems.push((unorderedMatch ?? orderedMatch)![1]!.trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }
  flushParagraph();
  flushList();

  return blocks;
}
