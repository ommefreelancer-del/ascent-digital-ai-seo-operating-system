import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

describe("LighthousePerformanceDataProvider", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("lighthouse");
    vi.doUnmock("chrome-launcher");
  });

  it("returns null and never launches Chrome for a private/internal URL (SSRF guard)", async () => {
    const launchMock = vi.fn();
    vi.doMock("chrome-launcher", () => ({ launch: launchMock }));
    vi.doMock("lighthouse", () => ({ default: vi.fn() }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();
    const result = await provider.fetchPerformanceData({ url: "http://127.0.0.1/", keywords: [] });

    expect(result).toBeNull();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("maps a real Lighthouse result into CoreWebVitalsSnapshot and kills Chrome afterward", async () => {
    const killMock = vi.fn(async () => undefined);
    vi.doMock("chrome-launcher", () => ({ launch: vi.fn(async () => ({ port: 9222, kill: killMock })) }));
    vi.doMock("lighthouse", () => ({
      default: vi.fn(async () => ({
        lhr: {
          audits: {
            "largest-contentful-paint": { numericValue: 1800 },
            "interaction-to-next-paint": { numericValue: 120 },
            "cumulative-layout-shift": { numericValue: 0.03 },
          },
        },
      })),
    }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();
    const result = await provider.fetchPerformanceData({ url: "http://public.example.com/", keywords: [] });

    expect(result).not.toBeNull();
    expect(result?.coreWebVitals).toEqual({ lcpMs: 1800, inpMs: 120, cls: 0.03 });
    expect(result?.rankings).toEqual([]);
    expect(result?.traffic).toBeNull();
    expect(result?.source).toBe("lighthouse");
    expect(killMock).toHaveBeenCalledTimes(1);
  });

  it("requests all four Lighthouse categories and maps real category scores (0-1 -> rounded 0-100)", async () => {
    const lighthouseMock = vi.fn(async () => ({
      lhr: {
        audits: {},
        categories: {
          performance: { score: 0.87 },
          accessibility: { score: 1 },
          "best-practices": { score: 0.749 },
          seo: { score: 0.92 },
        },
      },
    }));
    vi.doMock("chrome-launcher", () => ({ launch: vi.fn(async () => ({ port: 9222, kill: vi.fn() })) }));
    vi.doMock("lighthouse", () => ({ default: lighthouseMock }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();
    const result = await provider.fetchPerformanceData({ url: "http://public.example.com/", keywords: [] });

    expect(result?.categoryScores).toEqual({ performance: 87, accessibility: 100, bestPractices: 75, seo: 92 });
    expect(lighthouseMock).toHaveBeenCalledWith(
      "http://public.example.com/",
      expect.objectContaining({ onlyCategories: ["performance", "accessibility", "best-practices", "seo"] }),
    );
  });

  it("reports a category score as null when Lighthouse's result doesn't include that category", async () => {
    vi.doMock("chrome-launcher", () => ({ launch: vi.fn(async () => ({ port: 9222, kill: vi.fn() })) }));
    vi.doMock("lighthouse", () => ({
      default: vi.fn(async () => ({
        lhr: { audits: {}, categories: { performance: { score: 0.5 } } },
      })),
    }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();
    const result = await provider.fetchPerformanceData({ url: "http://public.example.com/", keywords: [] });

    expect(result?.categoryScores).toEqual({ performance: 50, accessibility: null, bestPractices: null, seo: null });
  });

  it("reports a metric as null when Lighthouse's audit result doesn't include it", async () => {
    vi.doMock("chrome-launcher", () => ({ launch: vi.fn(async () => ({ port: 9222, kill: vi.fn() })) }));
    vi.doMock("lighthouse", () => ({
      default: vi.fn(async () => ({
        lhr: { audits: { "largest-contentful-paint": { numericValue: 1800 } } },
      })),
    }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();
    const result = await provider.fetchPerformanceData({ url: "http://public.example.com/", keywords: [] });

    expect(result?.coreWebVitals).toEqual({ lcpMs: 1800, inpMs: null, cls: null });
  });

  it("returns null (never fabricates a partial result) when Lighthouse throws, and still kills Chrome", async () => {
    const killMock = vi.fn(async () => undefined);
    vi.doMock("chrome-launcher", () => ({ launch: vi.fn(async () => ({ port: 9222, kill: killMock })) }));
    vi.doMock("lighthouse", () => ({
      default: vi.fn(async () => {
        throw new Error("Lighthouse run failed");
      }),
    }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();
    const result = await provider.fetchPerformanceData({ url: "http://public.example.com/", keywords: [] });

    expect(result).toBeNull();
    expect(killMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when Lighthouse resolves with no lhr (e.g. cancelled run)", async () => {
    vi.doMock("chrome-launcher", () => ({ launch: vi.fn(async () => ({ port: 9222, kill: vi.fn() })) }));
    vi.doMock("lighthouse", () => ({ default: vi.fn(async () => undefined) }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();
    const result = await provider.fetchPerformanceData({ url: "http://public.example.com/", keywords: [] });

    expect(result).toBeNull();
  });

  it("REGRESSION: a chrome.kill() cleanup failure must not override an already-successful result (found via live-site testing: real EPERM on Windows temp-dir cleanup)", async () => {
    vi.doMock("chrome-launcher", () => ({
      launch: vi.fn(async () => ({
        port: 9222,
        kill: vi.fn(async () => {
          throw new Error("EPERM: permission denied deleting temp profile dir");
        }),
      })),
    }));
    vi.doMock("lighthouse", () => ({
      default: vi.fn(async () => ({
        lhr: { audits: { "largest-contentful-paint": { numericValue: 1800 } } },
      })),
    }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();

    await expect(provider.fetchPerformanceData({ url: "http://public.example.com/", keywords: [] })).resolves.toEqual(
      expect.objectContaining({ coreWebVitals: { lcpMs: 1800, inpMs: null, cls: null } }),
    );
  });

  it("REGRESSION: a chrome.kill() cleanup failure must not override an already-caught null result", async () => {
    vi.doMock("chrome-launcher", () => ({
      launch: vi.fn(async () => ({
        port: 9222,
        kill: vi.fn(async () => {
          throw new Error("EPERM: permission denied deleting temp profile dir");
        }),
      })),
    }));
    vi.doMock("lighthouse", () => ({
      default: vi.fn(async () => {
        throw new Error("Lighthouse run failed");
      }),
    }));

    const { LighthousePerformanceDataProvider } = await import(
      "../../../../src/agents/performance-analytics-agent/providers/lighthouse-performance-data-provider.js"
    );
    const provider = new LighthousePerformanceDataProvider();

    await expect(provider.fetchPerformanceData({ url: "http://public.example.com/", keywords: [] })).resolves.toBeNull();
  });
});
