import { boundaryCheckInputSchema } from "../utils/schemas.js";
import {
  LOCAL_TOOL,
  runTool,
  type AppServices,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";

export const boundaryCheckTool: ToolDefinition<typeof boundaryCheckInputSchema> = {
  name: "boundary_check",
  title: "Boundary check",
  description:
    "Point-in-polygon, convex hull and bounding box for {lat,lng} points; handles the antimeridian. " +
    "A bounding box that crosses the antimeridian has minLng > maxLng (RFC 7946).",
  annotations: LOCAL_TOOL,
  schema: boundaryCheckInputSchema,
  handler: (raw: unknown, services: AppServices): Promise<ToolResult> =>
    runTool(boundaryCheckInputSchema, raw, services, (input) => services.boundary.check(input)),
};
