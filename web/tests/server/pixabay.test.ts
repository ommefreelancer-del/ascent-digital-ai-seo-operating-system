import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers ?? {}),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const RAW_IMAGE_HIT = {
  id: 195893,
  pageURL: "https://pixabay.com/photos/blossom-bloom-flower-195893/",
  tags: "blossom, bloom, flower",
  previewURL: "https://cdn.pixabay.com/photo/195893_150.jpg",
  webformatURL: "https://pixabay.com/get/195893_640.jpg",
  webformatWidth: 640,
  webformatHeight: 426,
  user_id: 48777,
  user: "Josch13",
  userImageURL: "https://cdn.pixabay.com/user/48777_96.jpg",
};

const RAW_VIDEO_HIT = {
  id: 125,
  pageURL: "https://pixabay.com/videos/id-125/",
  tags: "ocean, sea, waves",
  duration: 20,
  videos: {
    large: { url: "https://cdn.pixabay.com/video/125/large.mp4", width: 1920, height: 1080, size: 1000, thumbnail: "https://cdn.pixabay.com/video/125/large.jpg" },
    medium: { url: "https://cdn.pixabay.com/video/125/medium.mp4", width: 1280, height: 720, size: 500, thumbnail: "https://cdn.pixabay.com/video/125/medium.jpg" },
    small: { url: "https://cdn.pixabay.com/video/125/small.mp4", width: 640, height: 360, size: 200, thumbnail: "https://cdn.pixabay.com/video/125/small.jpg" },
    tiny: { url: "https://cdn.pixabay.com/video/125/tiny.mp4", width: 320, height: 180, size: 100, thumbnail: "https://cdn.pixabay.com/video/125/tiny.jpg" },
  },
  user_id: 99,
  user: "Videographer",
  userImageURL: "https://cdn.pixabay.com/user/99_96.jpg",
};

beforeEach(() => {
  vi.resetModules();
  process.env.PIXABAY_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PIXABAY_API_KEY;
});

describe("searchImages", () => {
  it("GETs the real Images API and normalizes hits into the shared asset shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { total: 1, totalHits: 1, hits: [RAW_IMAGE_HIT] }));
    vi.stubGlobal("fetch", fetchMock);

    const { searchImages } = await import("../../src/server/pixabay");
    const result = await searchImages({ query: "blossom", imageType: "photo", orientation: "horizontal", safeSearch: true, order: "latest" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe("https://pixabay.com/api/");
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(url.searchParams.get("q")).toBe("blossom");
    expect(url.searchParams.get("image_type")).toBe("photo");
    expect(url.searchParams.get("orientation")).toBe("horizontal");
    expect(url.searchParams.get("safesearch")).toBe("true");
    expect(url.searchParams.get("order")).toBe("latest");

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toEqual({
      id: 195893,
      type: "image",
      sourceUrl: "https://pixabay.com/photos/blossom-bloom-flower-195893/",
      previewUrl: "https://cdn.pixabay.com/photo/195893_150.jpg",
      url: "https://pixabay.com/get/195893_640.jpg",
      width: 640,
      height: 426,
      tags: ["blossom", "bloom", "flower"],
      creator: {
        id: 48777,
        name: "Josch13",
        profileUrl: "https://pixabay.com/users/Josch13-48777/",
        imageUrl: "https://cdn.pixabay.com/user/48777_96.jpg",
      },
    });
  });

  it("throws PixabayNotConfiguredError when PIXABAY_API_KEY is unset, without calling fetch", async () => {
    delete process.env.PIXABAY_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { searchImages, PixabayNotConfiguredError } = await import("../../src/server/pixabay");
    await expect(searchImages({ query: "cats" })).rejects.toBeInstanceOf(PixabayNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty hits array when Pixabay has no matches, without treating it as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { total: 0, totalHits: 0, hits: [] })));

    const { searchImages } = await import("../../src/server/pixabay");
    const result = await searchImages({ query: "zzzznonexistentqueryzzzz" });
    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalHits).toBe(0);
  });

  it("throws PixabayApiError with the real status and body on an invalid API key (400)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, "Invalid API key")));

    const { searchImages, PixabayApiError } = await import("../../src/server/pixabay");
    await expect(searchImages({ query: "cats" })).rejects.toMatchObject({
      status: 400,
    } as Partial<InstanceType<typeof PixabayApiError>>);
  });

  it("retries a 5xx failure and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, "Internal Server Error"))
      .mockResolvedValueOnce(jsonResponse(200, { total: 1, totalHits: 1, hits: [RAW_IMAGE_HIT] }));
    vi.stubGlobal("fetch", fetchMock);

    const { searchImages } = await import("../../src/server/pixabay");
    const result = await searchImages({ query: "blossom" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.hits).toHaveLength(1);
  }, 10_000);

  it("throws PixabayRateLimitError after exhausting retries against a persistent 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, "Too Many Requests", { "retry-after": "1" })));

    const { searchImages, PixabayRateLimitError } = await import("../../src/server/pixabay");
    await expect(searchImages({ query: "cats" })).rejects.toBeInstanceOf(PixabayRateLimitError);
  }, 10_000);

  it("self-throttles before ever calling Pixabay once this process's own outbound limit is hit", async () => {
    const { rateLimit } = await import("../../src/server/rate-limit");
    for (let i = 0; i < 90; i++) rateLimit("pixabay-outbound", 90, 60_000);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { searchImages, PixabayRateLimitError } = await import("../../src/server/pixabay");
    await expect(searchImages({ query: "unique-self-throttle-query" })).rejects.toBeInstanceOf(PixabayRateLimitError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes page and per_page through to Pixabay and reflects them back on the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { total: 40, totalHits: 40, hits: [RAW_IMAGE_HIT] }));
    vi.stubGlobal("fetch", fetchMock);

    const { searchImages } = await import("../../src/server/pixabay");
    const result = await searchImages({ query: "blossom", page: 3, perPage: 5 });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("per_page")).toBe("5");
    expect(result.page).toBe(3);
    expect(result.perPage).toBe(5);
  });
});

describe("searchVideos", () => {
  it("GETs the real Video API and normalizes hits, preferring the medium rendition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { total: 1, totalHits: 1, hits: [RAW_VIDEO_HIT] }));
    vi.stubGlobal("fetch", fetchMock);

    const { searchVideos } = await import("../../src/server/pixabay");
    const result = await searchVideos({ query: "ocean", videoType: "film" });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe("https://pixabay.com/api/videos/");
    expect(url.searchParams.get("video_type")).toBe("film");

    expect(result.hits).toEqual([
      {
        id: 125,
        type: "video",
        sourceUrl: "https://pixabay.com/videos/id-125/",
        previewUrl: "https://cdn.pixabay.com/video/125/medium.jpg",
        url: "https://cdn.pixabay.com/video/125/medium.mp4",
        width: 1280,
        height: 720,
        tags: ["ocean", "sea", "waves"],
        duration: 20,
        creator: {
          id: 99,
          name: "Videographer",
          profileUrl: "https://pixabay.com/users/Videographer-99/",
          imageUrl: "https://cdn.pixabay.com/user/99_96.jpg",
        },
      },
    ]);
  });

  it("returns an empty hits array when Pixabay has no video matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { total: 0, totalHits: 0, hits: [] })));
    const { searchVideos } = await import("../../src/server/pixabay");
    const result = await searchVideos({ query: "zzzznonexistentzzzz" });
    expect(result.hits).toEqual([]);
  });
});
