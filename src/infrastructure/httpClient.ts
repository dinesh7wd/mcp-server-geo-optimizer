import { DEFAULT_USER_AGENT } from "../config.js";
import { ErrorCodes, McpError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { redactSecrets, redactUrl } from "../utils/redact.js";

export interface HttpRequest {
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly retries: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export interface HttpClientOptions {
  readonly userAgent?: string | undefined;
  readonly throttledHosts?: ReadonlyMap<string, number> | undefined;
  readonly maxResponseBytes?: number | undefined;
  readonly maxRetryWaitMs?: number | undefined;
}

interface ResolvedOptions {
  readonly userAgent: string;
  readonly maxResponseBytes: number;
  readonly maxRetryWaitMs: number;
}

interface FetchResult extends HttpResponse {
  readonly retryAfterMs: number | undefined;
}

type Throttle = <T>(url: string, task: () => Promise<T>) => Promise<T>;

export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_RETRY_WAIT_MS = 10_000;
const BASE_BACKOFF_MS = 200;
const RATE_LIMIT_BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function retryDelayMs(result: FetchResult, attempt: number, maxWaitMs: number): number | undefined {
  const floor = (result.status === 429 ? RATE_LIMIT_BACKOFF_MS : BASE_BACKOFF_MS) * 2 ** attempt;
  const delay = Math.max(floor, result.retryAfterMs ?? 0);
  return delay > maxWaitMs ? undefined : delay;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function createThrottle(hosts: ReadonlyMap<string, number>): Throttle {
  const queues = new Map<string, Promise<void>>();
  const lastStart = new Map<string, number>();
  return async <T>(url: string, task: () => Promise<T>): Promise<T> => {
    const host = hostOf(url);
    const interval = host === undefined ? undefined : hosts.get(host);
    if (host === undefined || interval === undefined) {
      return task();
    }
    const previous = queues.get(host) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const tail = previous.then(() => new Promise<void>((resolve) => (release = resolve)));
    queues.set(host, tail);
    await previous;
    try {
      const waitMs = (lastStart.get(host) ?? Number.NEGATIVE_INFINITY) + interval - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      lastStart.set(host, Date.now());
      return await task();
    } finally {
      release();
      if (queues.get(host) === tail) {
        queues.delete(host);
      }
    }
  };
}

function tooLarge(url: string, maxBytes: number): McpError {
  return new McpError(
    ErrorCodes.UpstreamError,
    `Response from ${redactUrl(url)} exceeded ${maxBytes} bytes`,
    { retryable: false },
  );
}

async function readBody(response: Response, url: string, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw tooLarge(url, maxBytes);
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(url, maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(text: string): unknown {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toRequestError(err: unknown, req: HttpRequest): McpError {
  if (err instanceof McpError) {
    return err;
  }
  const url = redactUrl(req.url);
  if (err instanceof Error && err.name === "AbortError") {
    return new McpError(
      ErrorCodes.Timeout,
      `Request to ${url} timed out after ${req.timeoutMs} ms`,
    );
  }
  const message = redactSecrets(err instanceof Error ? err.message : String(err));
  return new McpError(ErrorCodes.UpstreamError, `Request to ${url} failed: ${message}`);
}

async function fetchOnce(req: HttpRequest, options: ResolvedOptions): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    const init: RequestInit = {
      method: req.method ?? "GET",
      signal: controller.signal,
      headers: { "User-Agent": options.userAgent, ...req.headers },
    };
    if (req.body !== undefined) {
      init.body = req.body;
    }
    const response = await fetch(req.url, init);
    const text = await readBody(response, req.url, options.maxResponseBytes);
    return {
      status: response.status,
      body: parseBody(text),
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    };
  } catch (err) {
    throw toRequestError(err, req);
  } finally {
    clearTimeout(timer);
  }
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const resolved: ResolvedOptions = {
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    maxRetryWaitMs: options.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS,
  };
  const throttle = createThrottle(options.throttledHosts ?? new Map<string, number>());
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const attempts = req.retries + 1;
      const url = redactUrl(req.url);
      let lastError: McpError | undefined;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        let result: FetchResult;
        try {
          result = await throttle(req.url, () => fetchOnce(req, resolved));
        } catch (err) {
          lastError = toRequestError(err, req);
          if (attempt >= attempts - 1 || lastError.details?.retryable === false) {
            break;
          }
          const waitMs = BASE_BACKOFF_MS * 2 ** attempt;
          logger.warn("http_retry", { url, attempt, waitMs, code: lastError.code });
          await sleep(waitMs);
          continue;
        }
        const last = attempt >= attempts - 1;
        const waitMs =
          !last && isRetryableStatus(result.status)
            ? retryDelayMs(result, attempt, resolved.maxRetryWaitMs)
            : undefined;
        if (waitMs === undefined) {
          return { status: result.status, body: result.body };
        }
        logger.warn("http_retry", { url, status: result.status, attempt, waitMs });
        await sleep(waitMs);
      }
      throw lastError ?? new McpError(ErrorCodes.UpstreamError, `Request to ${url} failed`);
    },
  };
}
