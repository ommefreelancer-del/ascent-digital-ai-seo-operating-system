import { describe, expect, it, vi, afterEach } from "vitest";

describe("assertPublicHttpUrl", () => {
  afterEach(() => {
    vi.doUnmock("node:dns");
    vi.resetModules();
  });

  it("rejects a malformed URL", async () => {
    const { assertPublicHttpUrl } = await import("../../../src/core/crawling/url-safety.js");
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow("Enter a valid URL.");
  });

  it("rejects non-http(s) protocols", async () => {
    const { assertPublicHttpUrl } = await import("../../../src/core/crawling/url-safety.js");
    await expect(assertPublicHttpUrl("ftp://example.com/file")).rejects.toThrow("Only http:// and https:// URLs are allowed.");
  });

  it("rejects localhost by name", async () => {
    const { assertPublicHttpUrl } = await import("../../../src/core/crawling/url-safety.js");
    await expect(assertPublicHttpUrl("http://localhost:3000/")).rejects.toThrow("local address");
  });

  it("rejects direct loopback, RFC1918, and cloud-metadata IPs without needing DNS", async () => {
    const { assertPublicHttpUrl } = await import("../../../src/core/crawling/url-safety.js");
    await expect(assertPublicHttpUrl("http://127.0.0.1/")).rejects.toThrow("private or internal address");
    await expect(assertPublicHttpUrl("http://10.1.2.3/")).rejects.toThrow("private or internal address");
    await expect(assertPublicHttpUrl("http://192.168.1.1/")).rejects.toThrow("private or internal address");
    await expect(assertPublicHttpUrl("http://169.254.169.254/")).rejects.toThrow("private or internal address");
  });

  it("rejects the IPv6 loopback address", async () => {
    const { assertPublicHttpUrl } = await import("../../../src/core/crawling/url-safety.js");
    await expect(assertPublicHttpUrl("http://[::1]/")).rejects.toThrow("private or internal address");
  });

  it("allows a direct public IPv4 address", async () => {
    const { assertPublicHttpUrl } = await import("../../../src/core/crawling/url-safety.js");
    await expect(assertPublicHttpUrl("http://93.184.216.34/")).resolves.toBeInstanceOf(URL);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    vi.doMock("node:dns", () => ({
      promises: { lookup: vi.fn(async () => [{ address: "10.0.0.5", family: 4 }]) },
    }));
    const { assertPublicHttpUrl } = await import("../../../src/core/crawling/url-safety.js");
    await expect(assertPublicHttpUrl("http://internal.example.com/")).rejects.toThrow("private or internal address");
  });

  it("allows a hostname that resolves to a public address", async () => {
    vi.doMock("node:dns", () => ({
      promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
    }));
    const { assertPublicHttpUrl } = await import("../../../src/core/crawling/url-safety.js");
    await expect(assertPublicHttpUrl("http://public.example.com/")).resolves.toBeInstanceOf(URL);
  });
});
