import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    googleServiceConnection: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

const VALID_CONNECTION = {
  userId: "user-1",
  service: "gmail",
  accessToken: "valid-access-token",
  refreshToken: "refresh-token",
  scope: "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

beforeEach(() => {
  vi.resetModules();
  findUniqueMock.mockReset();
  updateMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDraft", () => {
  it("POSTs to the real drafts.create endpoint with a base64url-encoded RFC 2822 message, never sending", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createDraft } = await import("../../src/server/gmail");
    const result = await createDraft("user-1", { to: "prospect@example.com", subject: "Hello", body: "Real body text." });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer valid-access-token");
    const sentBody = JSON.parse(init.body);
    expect(sentBody.message.threadId).toBeUndefined();
    const decoded = Buffer.from(sentBody.message.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decoded).toContain("To: prospect@example.com");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("Real body text.");
    expect(result).toEqual({ id: "draft-1", messageId: "msg-1", threadId: "thread-1" });
  });

  it("throws when there is no Gmail connection for the user", async () => {
    findUniqueMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { createDraft } = await import("../../src/server/gmail");
    await expect(createDraft("user-1", { to: "a@b.com", subject: "s", body: "b" })).rejects.toThrow(
      "No Gmail connection exists for this user.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendDraft", () => {
  it("POSTs to the real drafts.send endpoint with the given draft id", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "msg-1", threadId: "thread-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { sendDraft } = await import("../../src/server/gmail");
    const result = await sendDraft("user-1", "draft-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts/send");
    expect(JSON.parse(init.body)).toEqual({ id: "draft-1" });
    expect(result).toEqual({ messageId: "msg-1", threadId: "thread-1" });
  });

  it("throws with the full response body when Google returns a non-2xx status", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden", text: async () => '{"error":"insufficient scope"}' }),
    );

    const { sendDraft } = await import("../../src/server/gmail");
    await expect(sendDraft("user-1", "draft-1")).rejects.toThrow(/Gmail drafts\.send failed: 403 Forbidden.*insufficient scope/);
  });
});

describe("getThread", () => {
  it("GETs the real threads.get endpoint and detects a real reply from a received message", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          id: "thread-1",
          messages: [
            {
              id: "msg-1",
              threadId: "thread-1",
              labelIds: ["SENT"],
              snippet: "Our outreach",
              internalDate: "1000",
              payload: { headers: [{ name: "From", value: "me@adasos.test" }, { name: "To", value: "prospect@example.com" }, { name: "Subject", value: "Hi" }] },
            },
            {
              id: "msg-2",
              threadId: "thread-1",
              labelIds: ["INBOX"],
              snippet: "Thanks for reaching out",
              internalDate: "2000",
              payload: { headers: [{ name: "From", value: "prospect@example.com" }, { name: "To", value: "me@adasos.test" }, { name: "Subject", value: "Re: Hi" }] },
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getThread } = await import("../../src/server/gmail");
    const result = await getThread("user-1", "thread-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-1");
    expect(init.headers.Authorization).toBe("Bearer valid-access-token");
    expect(result.hasReply).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.isReceived).toBe(false);
    expect(result.messages[1]!.isReceived).toBe(true);
    expect(result.messages[1]!.from).toBe("prospect@example.com");
  });

  it("reports hasReply false when only our own sent message exists", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: "thread-1",
            messages: [{ id: "msg-1", threadId: "thread-1", labelIds: ["SENT"], snippet: "", internalDate: "1000", payload: { headers: [] } }],
          }),
      }),
    );

    const { getThread } = await import("../../src/server/gmail");
    const result = await getThread("user-1", "thread-1");
    expect(result.hasReply).toBe(false);
  });
});
