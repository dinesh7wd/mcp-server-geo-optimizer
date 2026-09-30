import { geocodeInputSchema } from "../utils/schemas.js";
import {
  NETWORK_TOOL,
  runTool,
  type AppServices,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";

export const geocodeTool: ToolDefinition<typeof geocodeInputSchema> = {
  name: "geocode",
  title: "Geocode",
  description:
    "Forward-geocode an address or reverse-geocode lat/lng using the configured provider " +
    "(Nominatim by default, rate-limited to 1 request per second). Returns lat, lng and a display name.",
  annotations: NETWORK_TOOL,
  schema: geocodeInputSchema,
  handler: (raw: unknown, services: AppServices): Promise<ToolResult> =>
    runTool(geocodeInputSchema, raw, services, (input) => services.geocoding.geocode(input)),
};
