#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_USER_AGENT, loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";
import { redactUrl } from "./utils/redact.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("geo-optimizer listening on stdio", {
    provider: config.geocodingProvider,
    osrmUrl: redactUrl(config.osrmUrl),
  });
  if (config.userAgent === DEFAULT_USER_AGENT && config.geocodingProvider === "nominatim") {
    logger.warn(
      "GEO_USER_AGENT is not set; the Nominatim usage policy asks for an identifying User-Agent with contact details",
    );
  }
}

main().catch((err: unknown) => {
  logger.error("fatal", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
