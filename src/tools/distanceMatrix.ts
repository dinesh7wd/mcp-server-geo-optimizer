import { distanceMatrixInputSchema, MAX_MATRIX_CELLS } from "../utils/schemas.js";
import {
  NETWORK_TOOL,
  runTool,
  type AppServices,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";

export const distanceMatrixTool: ToolDefinition<typeof distanceMatrixInputSchema> = {
  name: "distance_matrix",
  title: "Distance matrix",
  description:
    "Compute distances (km) and travel times (minutes) from each origin (rows) to each destination (columns). " +
    `At most ${MAX_MATRIX_CELLS} cells per request. haversine is local; osrm calls the configured OSRM server.`,
  annotations: NETWORK_TOOL,
  schema: distanceMatrixInputSchema,
  handler: (raw: unknown, services: AppServices): Promise<ToolResult> =>
    runTool(distanceMatrixInputSchema, raw, services, (input) => services.matrix.compute(input)),
};
