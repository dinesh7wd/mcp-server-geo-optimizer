import { geojsonUtilsInputSchema } from "../utils/schemas.js";
import {
  LOCAL_TOOL,
  runTool,
  type AppServices,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";

export const geojsonUtilsTool: ToolDefinition<typeof geojsonUtilsInputSchema> = {
  name: "geojson_utils",
  title: "GeoJSON utilities",
  description:
    "Validate GeoJSON (structure, coordinate ranges, closed rings), simplify lines and polygon rings " +
    "(altitude preserved), or convert {lat,lng} points to a FeatureCollection.",
  annotations: LOCAL_TOOL,
  schema: geojsonUtilsInputSchema,
  handler: (raw: unknown, services: AppServices): Promise<ToolResult> =>
    runTool(geojsonUtilsInputSchema, raw, services, (input) => services.boundary.geojson(input)),
};
