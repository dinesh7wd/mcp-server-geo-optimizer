import { redactSecrets } from "./redact.js";

export const ErrorCodes = {
  InvalidParams: "InvalidParams",
  InternalError: "InternalError",
  GeocodingFailed: "GeocodingFailed",
  RouteFail: "ROUTE_FAIL",
  ClusterFail: "CLUSTER_FAIL",
  GeometryFail: "GEOMETRY_FAIL",
  ProviderConfig: "PROVIDER_CONFIG",
  Timeout: "TIMEOUT",
  UpstreamError: "UPSTREAM_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class DomainError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.reason = reason;
  }
}

export class McpError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "McpError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  toJSON(): { code: ErrorCode; message: string; details?: Readonly<Record<string, unknown>> } {
    if (this.details !== undefined) {
      return { code: this.code, message: this.message, details: this.details };
    }
    return { code: this.code, message: this.message };
  }
}

export function isMcpError(value: unknown): value is McpError {
  return value instanceof McpError;
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

function messageOf(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}

export function toMcpError(err: unknown): McpError {
  if (isMcpError(err)) {
    return err;
  }
  if (isDomainError(err)) {
    return new McpError(ErrorCodes.InvalidParams, err.message);
  }
  return new McpError(ErrorCodes.InternalError, messageOf(err));
}

export function wrapError(err: unknown, fallback: ErrorCode): McpError {
  if (isMcpError(err) || isDomainError(err)) {
    return toMcpError(err);
  }
  return new McpError(fallback, messageOf(err));
}
