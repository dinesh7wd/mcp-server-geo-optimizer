import { describe, expect, it, vi } from "vitest";
import { LruCache } from "../../../src/infrastructure/cache.js";
import { createHttpClient, parseRetryAfter } from "../../../src/infrastructure/httpClient.js";
import { ErrorCodes } from "../../../src/utils/errors.js";
import { setLogLevel } from "../../../src/utils/logger.js";
import { captureStderr } from "../../helpers.js";

const SECRET = "SECRET_KEY_123";
const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=x&key=${SECRET}`;
const FAKE_TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout", "Date"],
};

function hangingFetch(): typeof fetch {
  return vi.fn(
    async (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  ) as unknown as typeof fetch;
}

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new LruCache(2, 60);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("expires entries after ttl", () => {
    vi.useFakeTimers();
    const cache = new LruCache(2, 1);
    cache.set("a", 1);
    vi.advanceTimersByTime(1100);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.weight).toBe(0);
  });

  it("bounds total weight and skips oversized entries", () => {
    const cache = new LruCache(10, 60, 5);
    cache.set("a", "x", 3);
    cache.set("b", "y", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.weight).toBe(3);
    cache.set("huge", "z", 6);
    expect(cache.get("huge")).toBeUndefined();
    cache.set("b", "y2", 2);
    expect(cache.weight).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.weight).toBe(0);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(" ")).toBeUndefined();
  });
});

describe("httpClient", () => {
  it("retries retryable statuses then returns the success", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("no", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = createHttpClient().request({
      url: "http://example.test",
      timeoutMs: 1000,
      retries: 2,
    });
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toEqual({ status: 200, body: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("redacts API keys from timeout errors and retry logs", async () => {
    setLogLevel("debug");
    const lines = captureStderr();
    vi.stubGlobal("fetch", hangingFetch());
    const error = await createHttpClient()
      .request({ url: googleUrl, timeoutMs: 5, retries: 1 })
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ code: ErrorCodes.Timeout });
    const message = (error as Error).message;
    expect(message).not.toContain(SECRET);
    expect(message).toContain("key=REDACTED");
    expect(lines.join("")).toContain("http_retry");
    expect(lines.join("")).not.toContain(SECRET);
  });

  it("redacts API keys from network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error(`ENOTFOUND ${googleUrl}`)),
    );
    const error = await createHttpClient()
      .request({ url: googleUrl, timeoutMs: 1000, retries: 0 })
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ code: ErrorCodes.UpstreamError });
    expect((error as Error).message).not.toContain(SECRET);
  });

  it("does not retry 400s", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await createHttpClient().request({
      url: "http://example.test",
      timeoutMs: 1000,
      retries: 3,
    });
    expect(res).toEqual({ status: 400, body: "bad" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits at least one second before retrying a 429 without Retry-After", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = createHttpClient().request({
      url: "http://example.test",
      timeoutMs: 5000,
      retries: 1,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ status: 200, body: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = createHttpClient().request({
      url: "http://example.test",
      timeoutMs: 5000,
      retries: 1,
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ status: 200, body: {} });
  });

  it("gives up instead of waiting when Retry-After is too long", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 503, headers: { "Retry-After": "3600" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await createHttpClient().request({
      url: "http://example.test",
      timeoutMs: 5000,
      retries: 3,
    });
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("spaces requests to throttled hosts by the configured interval", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const start = Date.now();
    const calls: { host: string; at: number }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push({ host: new URL(url).host, at: Date.now() - start });
        return new Response("{}");
      }),
    );
    const client = createHttpClient({
      throttledHosts: new Map([["nominatim.openstreetmap.org", 1000]]),
    });
    const nominatim = {
      url: "https://nominatim.openstreetmap.org/search?q=a",
      timeoutMs: 5000,
      retries: 0,
    };
    const pending = Promise.all([
      client.request(nominatim),
      client.request(nominatim),
      client.request(nominatim),
      client.request({ ...nominatim, url: "https://other.test/x" }),
    ]);
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    const throttled = calls
      .filter((c) => c.host === "nominatim.openstreetmap.org")
      .map((c) => c.at);
    expect(throttled).toEqual([0, 1000, 2000]);
    expect(calls.find((c) => c.host === "other.test")?.at).toBe(0);
  });

  it("sends a default User-Agent that callers can override", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await createHttpClient({ userAgent: "geo-test/1.0 (a@b.c)" }).request({
      url: "http://example.test",
      timeoutMs: 1000,
      retries: 0,
    });
    await createHttpClient().request({
      url: "http://example.test",
      headers: { "User-Agent": "custom" },
      timeoutMs: 1000,
      retries: 0,
    });
    const headers = fetchMock.mock.calls.map(
      (call) => (call[1]?.headers as Record<string, string>)["User-Agent"],
    );
    expect(headers).toEqual(["geo-test/1.0 (a@b.c)", "custom"]);
  });

  it("rejects responses larger than the limit without retrying", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response("x".repeat(10), { headers: { "content-length": "10" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = createHttpClient({ maxResponseBytes: 5 });
    await expect(
      client.request({ url: "http://example.test", timeoutMs: 1000, retries: 2 }),
    ).rejects.toMatchObject({
      code: ErrorCodes.UpstreamError,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops reading streamed bodies past the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => new Response("y".repeat(64))),
    );
    const client = createHttpClient({ maxResponseBytes: 16 });
    await expect(
      client.request({ url: "http://example.test", timeoutMs: 1000, retries: 0 }),
    ).rejects.toThrow(/exceeded 16 bytes/);
  });

  it("returns non-JSON bodies as text and sends POST bodies", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("plain text"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await createHttpClient().request({
      url: "http://example.test",
      method: "POST",
      body: "{}",
      timeoutMs: 1000,
      retries: 0,
    });
    expect(res.body).toBe("plain text");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "{}" });
  });
});
