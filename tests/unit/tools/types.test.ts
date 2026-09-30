import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createServices } from "../../../src/server.js";
import { toRawShape } from "../../../src/tools/index.js";
import { fail, MAX_OUTPUT_CHARS, ok, runTool } from "../../../src/tools/types.js";
import { ErrorCodes, McpError } from "../../../src/utils/errors.js";
import { captureStderr, testConfig } from "../../helpers.js";

describe("tool result helpers", () => {
  it("emits compact JSON", () => {
    const result = ok({ a: [1, 2], b: { c: true } });
    expect(result.content[0]?.text).toBe('{"a":[1,2],"b":{"c":true}}');
    expect(result.isError).toBeUndefined();
  });

  it("refuses to return results above the output cap", () => {
    const result = ok({ blob: "x".repeat(MAX_OUTPUT_CHARS) });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
  });

  it("returns McpErrors as structured JSON with secrets redacted", () => {
    const result = fail(
      new McpError(ErrorCodes.Timeout, "GET https://x.test/?key=SECRET timed out"),
      "production",
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"code":"TIMEOUT"');
    expect(result.content[0]?.text).not.toContain("SECRET");
  });

  it("masks unexpected errors in production only and logs them redacted", () => {
    const stderr = captureStderr();
    expect(
      JSON.parse(fail(new Error("db password"), "production").content[0]?.text ?? "{}"),
    ).toEqual({
      code: ErrorCodes.InternalError,
      message: "Internal error",
    });
    expect(
      fail(new Error("GET https://x.test/?token=abc"), "development").content[0]?.text,
    ).toContain("token=REDACTED");
    expect(stderr.join("")).toContain("db password");
    expect(stderr.join("")).not.toContain("token=abc");
  });

  it("maps Zod failures to InvalidParams", async () => {
    const services = createServices(testConfig());
    const result = await runTool(z.object({ n: z.number() }), { n: "x" }, services, () => "unused");
    expect(result.content[0]?.text).toContain('"code":"InvalidParams"');
    expect(result.content[0]?.text).toContain("n: Expected number");
  });

  it("extracts raw shapes from refined object schemas only", () => {
    expect(
      Object.keys(toRawShape(z.object({ a: z.string() }).superRefine(() => undefined))),
    ).toEqual(["a"]);
    expect(() => toRawShape(z.string())).toThrow(/must be a Zod object/);
  });
});
