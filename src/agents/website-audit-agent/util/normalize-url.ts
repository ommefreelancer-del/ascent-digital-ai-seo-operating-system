// Resolves `href` against `base` and returns its canonical string form for
// comparison, or `null` if either is not a parseable URL. Never throws --
// malformed URLs are a normal, expected input, not a bug.
export function normalizeUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
