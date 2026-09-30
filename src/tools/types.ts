import { ZodError, type z } from "zod";
import type { AppConfig } from "../config.js";
import type { BoundaryService } from "../services/boundaryService.js";
import type { ClusterService } from "../services/clusterService.js";
import type { GeocodingService } from "../services/geocodingService.js";
import type { MatrixService } from "../services/matrixService.js";
import type { RoutingService } from "../services/routingService.js";
import { ErrorCodes, isMcpError, McpError, toMcpError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { redactSecrets } from "../utils/redact.js";
import { zodToErrorMessage } from "../utils/schemas.js";

export const MAX_OUTPUT_CHARS = 100_000;

export interface AppServices {
  readonly config: AppConfig;
  readonly routing: RoutingService;
  readonly geocoding: GeocodingService;
  readonly matrix: MatrixService;
  readonly cluster: ClusterService;
  readonly boundary: BoundaryService;
}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean | undefined;
}

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export const LOCAL_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const NETWORK_TOOL: ToolAnnotations = { ...LOCAL_TOOL, openWorldHint: true };

export interface ToolDefinition<T extends z.ZodType> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  readonly schema: T;
  readonly handler: (raw: unknown, services: AppServices) => Promise<ToolResult>;
}

function errorResult(payload: unknown): ToolResult {
  return {
    content: [{ type: "text", text: redactSecrets(JSON.stringify(payload)) }],
    isError: true,
  };
}

export function ok(data: unknown): ToolResult {
  const text = JSON.stringify(data);
  if (text.length > MAX_OUTPUT_CHARS) {
    return errorResult(
      new McpError(
        ErrorCodes.InvalidParams,
        `Result is ${text.length} characters, above the ${MAX_OUTPUT_CHARS} limit; reduce the input size`,
      ).toJSON(),
    );
  }
  return { content: [{ type: "text", text }] };
}

export function fail(err: unknown, nodeEnv: AppConfig["nodeEnv"]): ToolResult {
  const mapped = toMcpError(err);
  if (isMcpError(err)) {
    logger.warn("tool_error", { code: mapped.code, message: mapped.message });
    return errorResult(mapped.toJSON());
  }
  logger.error("unhandled_tool_error", {
    code: mapped.code,
    message: mapped.message,
    stack: err instanceof Error ? err.stack : undefined,
  });
  return errorResult(
    nodeEnv === "production"
      ? { code: ErrorCodes.InternalError, message: "Internal error" }
      : mapped.toJSON(),
  );
}

export async function runTool<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  services: AppServices,
  run: (input: z.output<S>) => Promise<unknown> | unknown,
): Promise<ToolResult> {
  try {
    const input = schema.parse(raw) as z.output<S>;
    return ok(await run(input));
  } catch (err) {
    if (err instanceof ZodError) {
      return fail(
        new McpError(ErrorCodes.InvalidParams, zodToErrorMessage(err)),
        services.config.nodeEnv,
      );
    }
    return fail(err, services.config.nodeEnv);
  }
}
