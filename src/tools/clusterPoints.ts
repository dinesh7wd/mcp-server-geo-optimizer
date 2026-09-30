import { clusterPointsInputSchema } from "../utils/schemas.js";
import {
  LOCAL_TOOL,
  runTool,
  type AppServices,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";

export const clusterPointsTool: ToolDefinition<typeof clusterPointsInputSchema> = {
  name: "cluster_points",
  title: "Cluster points",
  description:
    "Group geographic points with deterministic k-means (seeded) or DBSCAN (epsKm radius). Returns clusters " +
    "with size, centroid (date-line safe) and member points; DBSCAN noise is returned as a cluster with noise=true.",
  annotations: LOCAL_TOOL,
  schema: clusterPointsInputSchema,
  handler: (raw: unknown, services: AppServices): Promise<ToolResult> =>
    runTool(clusterPointsInputSchema, raw, services, (input) => services.cluster.cluster(input)),
};
