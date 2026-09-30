#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
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
}

main().catch((err: unknown) => {
  logger.error("fatal", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
