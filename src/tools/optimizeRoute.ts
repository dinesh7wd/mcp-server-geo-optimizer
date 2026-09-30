import { optimizeRouteInputSchema } from "../utils/schemas.js";
import {
  NETWORK_TOOL,
  runTool,
  type AppServices,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";

export const optimizeRouteTool: ToolDefinition<typeof optimizeRouteInputSchema> = {
  name: "optimize_route",
  title: "Optimize route",
  description:
    "Order stops for one or more vehicles (TSP/VRP) starting at waypoints[startIndex], with optional capacity " +
    "and time windows in minutes after route start. Returns per-vehicle stop order (waypoint indices) with " +
    "arrival/wait/departure minutes, distance in km, time-window violations and unassigned stops. Uses " +
    "straight-line distances unless useOsrm is true.",
  annotations: NETWORK_TOOL,
  schema: optimizeRouteInputSchema,
  handler: (raw: unknown, services: AppServices): Promise<ToolResult> =>
    runTool(optimizeRouteInputSchema, raw, services, (input) => services.routing.optimize(input)),
};
