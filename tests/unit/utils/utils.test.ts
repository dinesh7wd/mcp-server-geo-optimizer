import { describe, expect, it } from "vitest";
import {
  DomainError,
  ErrorCodes,
  McpError,
  toMcpError,
  wrapError,
} from "../../../src/utils/errors.js";
import { round, roundDeg, roundKm, roundMatrix, roundMin } from "../../../src/utils/format.js";
import { getLogLevel, logger, setLogLevel } from "../../../src/utils/logger.js";
import { redactSecrets, redactUrl } from "../../../src/utils/redact.js";
import { isFiniteNumber, requireIndex } from "../../../src/utils/validators.js";
import { captureStderr } from "../../helpers.js";

describe("redaction", () => {
  it("redacts secret query parameters in URLs", () => {
    const url = redactUrl("https://api.mapbox.com/x.json?limit=1&access_token=pk.SECRET");
    expect(url).not.toContain("SECRET");
    expect(url).toContain("access_token=REDACTED");
    expect(url).toContain("limit=1");
    expect(redactUrl("https://h.test/?KEY=abc&api_key=def&token=ghi")).not.toMatch(/abc|def|ghi/);
  });

  it("redacts URL credentials", () => {
    const url = redactUrl("https://user:pass@osrm.internal/route");
    expect(url).not.toContain("user:pass");
    expect(url).toContain("REDACTED@osrm.internal");
  });

  it("falls back to pattern redaction for unparseable input", () => {
    expect(redactUrl("not a url ?key=SECRET")).toBe("not a url ?key=REDACTED");
  });

  it("redacts secrets embedded in free text", () => {
    const text = redactSecrets(
      'failed "https://a.test/g?address=x&key=SECRET" and https://u:p@b.test/',
    );
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("u:p@");
    expect(text).toContain("key=REDACTED");
  });
});

describe("errors", () => {
  it("passes existing McpErrors through unchanged", () => {
    const original = new McpError(ErrorCodes.Timeout, "slow");
    expect(wrapError(original, ErrorCodes.RouteFail)).toBe(original);
    expect(toMcpError(original)).toBe(original);
  });

  it("maps domain errors to InvalidParams and others to the fallback", () => {
    expect(wrapError(new DomainError("X", "bad"), ErrorCodes.RouteFail).code).toBe(
      ErrorCodes.InvalidParams,
    );
    expect(wrapError(new Error("boom"), ErrorCodes.RouteFail).code).toBe(ErrorCodes.RouteFail);
    expect(wrapError("plain", ErrorCodes.ClusterFail).message).toBe("plain");
    expect(toMcpError(new Error("x")).code).toBe(ErrorCodes.InternalError);
  });

  it("redacts secrets from wrapped messages", () => {
    const err = wrapError(new Error("GET https://x.test/?key=SECRET failed"), ErrorCodes.RouteFail);
    expect(err.message).not.toContain("SECRET");
  });

  it("serializes details only when present", () => {
    expect(new McpError(ErrorCodes.InternalError, "boom").toJSON()).toEqual({
      code: ErrorCodes.InternalError,
      message: "boom",
    });
    expect(new McpError(ErrorCodes.RouteFail, "x", { status: 500 }).toJSON().details).toEqual({
      status: 500,
    });
  });
});

describe("format", () => {
  it("rounds to fixed precision and normalizes negative zero", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(Object.is(round(-0.0001, 2), 0)).toBe(true);
    expect(roundKm(1.23456)).toBe(1.235);
    expect(roundMin(1.23456)).toBe(1.23);
    expect(roundDeg(1.1234567)).toBe(1.123457);
    expect(roundMatrix([[1.23456, 2]], 1)).toEqual([[1.2, 2]]);
  });
});

describe("logger", () => {
  it("writes JSON to stderr, honours the level and redacts secrets", () => {
    const lines = captureStderr();
    setLogLevel("warn");
    expect(getLogLevel()).toBe("warn");
    logger.info("hidden");
    logger.debug("hidden");
    logger.warn("shown", { url: "https://x.test/?key=SECRET" });
    logger.error("also shown");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first.level).toBe("warn");
    expect(first.url).toBe("https://x.test/?key=REDACTED");
    expect(lines.join("")).not.toContain("SECRET");
  });
});

describe("validators", () => {
  it("checks finite numbers and indices", () => {
    expect(isFiniteNumber(1)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber("1")).toBe(false);
    expect(requireIndex([1, 2], 1, "item")).toBe(2);
    expect(() => requireIndex([1], 3, "item")).toThrow(/item index 3 is out of range/);
  });
});
