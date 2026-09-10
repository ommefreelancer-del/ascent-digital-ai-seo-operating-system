import { describe, expect, it } from "vitest";
import { dedupeDirectoryIndexVariants } from "../../../src/core/crawling/dedupe-directory-index-variants.js";

describe("dedupeDirectoryIndexVariants", () => {
  it("drops the index.html URL when its directory sibling has identical HTML", () => {
    const pages = [
      { url: "https://site.example/about/", html: "<html>About</html>" },
      { url: "https://site.example/about/index.html", html: "<html>About</html>" },
    ];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/about/"]);
  });

  it("does the same at the site root (/ vs /index.html)", () => {
    const pages = [
      { url: "https://site.example/", html: "<html>Home</html>" },
      { url: "https://site.example/index.html", html: "<html>Home</html>" },
    ];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/"]);
  });

  it("keeps both URLs when the directory and index.html serve genuinely different content", () => {
    const pages = [
      { url: "https://site.example/about/", html: "<html>About (directory)</html>" },
      { url: "https://site.example/about/index.html", html: "<html>About (a different page)</html>" },
    ];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/about/", "https://site.example/about/index.html"]);
  });

  it("keeps an index.html URL as-is when its directory sibling was never crawled", () => {
    const pages = [{ url: "https://site.example/about/index.html", html: "<html>About</html>" }];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/about/index.html"]);
  });

  it("keeps a directory URL as-is when no index.html sibling was crawled", () => {
    const pages = [{ url: "https://site.example/about/", html: "<html>About</html>" }];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/about/"]);
  });

  it("never drops a URL that does not end in index.html, regardless of content", () => {
    const pages = [
      { url: "https://site.example/services/", html: "<html>Services</html>" },
      { url: "https://site.example/services.html", html: "<html>Services</html>" },
    ];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/services/", "https://site.example/services.html"]);
  });

  it("handles multiple independent directory/index.html pairs in one crawl", () => {
    const pages = [
      { url: "https://site.example/", html: "home" },
      { url: "https://site.example/index.html", html: "home" },
      { url: "https://site.example/about/", html: "about" },
      { url: "https://site.example/about/index.html", html: "about" },
      { url: "https://site.example/blog/post-1.html", html: "post 1" },
    ];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/", "https://site.example/about/", "https://site.example/blog/post-1.html"]);
  });

  it("does not treat two null-html entries as identical", () => {
    const pages = [
      { url: "https://site.example/about/", html: null },
      { url: "https://site.example/about/index.html", html: null },
    ];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/about/", "https://site.example/about/index.html"]);
  });

  it("preserves the original relative order of the URLs that remain", () => {
    const pages = [
      { url: "https://site.example/contact/", html: "contact" },
      { url: "https://site.example/", html: "home" },
      { url: "https://site.example/index.html", html: "home" },
      { url: "https://site.example/faq/", html: "faq" },
    ];
    expect(dedupeDirectoryIndexVariants(pages)).toEqual(["https://site.example/contact/", "https://site.example/", "https://site.example/faq/"]);
  });
});
