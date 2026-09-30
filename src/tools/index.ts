import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { boundaryCheckTool } from "./boundaryCheck.js";
import { clusterPointsTool } from "./clusterPoints.js";
import { distanceMatrixTool } from "./distanceMatrix.js";
import { geocodeTool } from "./geocode.js";
import { geojsonUtilsTool } from "./geojsonUtils.js";
import { optimizeRouteTool } from "./optimizeRoute.js";
import type { AppServices } from "./types.js";

export const toolRegistry = [
  optimizeRouteTool,
  geocodeTool,
  distanceMatrixTool,
  clusterPointsTool,
  boundaryCheckTool,
  geojsonUtilsTool,
] as const;

export function registerTools(server: McpServer, services: AppServices): void {
  for (const tool of toolRegistry) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: toRawShape(tool.schema),
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args) => tool.handler(args, services),
    );
  }
}

export function toRawShape(schema: z.ZodType): ZodRawShape {
  let current: z.ZodType = schema;
  if (current instanceof z.ZodEffects) {
    current = current.innerType();
  }
  if (current instanceof z.ZodObject) {
    return current.shape as ZodRawShape;
  }
  throw new Error("Tool schema must be a Zod object");
}
