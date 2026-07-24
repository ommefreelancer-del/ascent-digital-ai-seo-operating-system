// Deterministically extracts a real quoted price from real reply text --
// per the spec's "Extract quoted prices and terms" responsibility. Only a
// real, pattern-matched numeric price (e.g. "$150" or "$150.00") is ever
// returned; when no such pattern exists in the text, this returns `null`
// rather than guessing a figure.

export interface ExtractedPrice {
  readonly price: number;
  readonly rawText: string;
}

const PRICE_PATTERN = /\$\s?(\d+(?:\.\d{1,2})?)/;
const CONTEXT_RADIUS = 40;

export function extractQuotedPrice(messageText: string): ExtractedPrice | null {
  const match = PRICE_PATTERN.exec(messageText);
  if (!match || match[1] === undefined) {
    return null;
  }

  const price = Number(match[1]);
  const start = Math.max(0, match.index - CONTEXT_RADIUS);
  const end = Math.min(messageText.length, match.index + match[0].length + CONTEXT_RADIUS);
  const rawText = messageText.slice(start, end).trim();

  return { price, rawText };
}
