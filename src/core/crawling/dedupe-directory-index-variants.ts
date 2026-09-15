// Drops a `.../index.html` URL from a set of already-crawled pages when its
// sibling directory URL (the same path with the trailing "index.html"
// replaced by nothing, e.g. ".../about/index.html" -> ".../about/") was ALSO
// crawled with byte-identical HTML -- the real, general signature of a
// static host serving the exact same file two ways (a directory URL resolves
// to its own index.html by web-server convention; GitHub Pages and most
// static hosts do this for every directory). Never guesses which variant is
// "canonical" from the URL shape alone -- only content actually observed by
// THIS SAME crawl decides, so a site that genuinely serves different content
// at the two paths (a real, deliberate separate page), or where only one
// variant was ever reached, keeps every URL it was given, unaltered.
//
// Exists because a site's own real crawl evidence otherwise contains both
// "https://site/about/" and "https://site/about/index.html" as two entries
// (both genuinely, successfully fetched -- neither is wrong), which a
// sitemap built directly from that evidence would then list as two separate
// URLs for what is, in reality, one page -- exactly the "duplicate
// directory/file variant" a sitemap must not contain.

export interface CrawledPageForDedup {
  readonly url: string;
  readonly html: string | null;
}

const INDEX_HTML_SUFFIX = "index.html";

function directorySiblingOf(url: string): string | null {
  if (!url.endsWith(INDEX_HTML_SUFFIX)) return null;
  return url.slice(0, -INDEX_HTML_SUFFIX.length);
}

/**
 * Returns the URLs from `pages`, in their original relative order, with any
 * `.../index.html` entry removed when its `.../` sibling is also present in
 * `pages` with identical (non-null) HTML content.
 */
export function dedupeDirectoryIndexVariants(pages: readonly CrawledPageForDedup[]): string[] {
  const htmlByUrl = new Map<string, string | null>();
  for (const page of pages) {
    htmlByUrl.set(page.url, page.html);
  }

  const dropped = new Set<string>();
  for (const page of pages) {
    const sibling = directorySiblingOf(page.url);
    if (sibling === null) continue;
    if (!htmlByUrl.has(sibling)) continue;

    const siblingHtml = htmlByUrl.get(sibling);
    if (page.html !== null && siblingHtml !== null && siblingHtml === page.html) {
      dropped.add(page.url);
    }
  }

  return pages.filter((page) => !dropped.has(page.url)).map((page) => page.url);
}
