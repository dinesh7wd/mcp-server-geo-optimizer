import type { GeocodeHit, GeocodingClient } from "../infrastructure/geocodingClient.js";
import { ErrorCodes, McpError, wrapError } from "../utils/errors.js";
import type { GeocodeInput } from "../utils/schemas.js";

export interface GeocodingService {
  geocode(input: GeocodeInput): Promise<readonly GeocodeHit[]>;
}

export function createGeocodingService(client: GeocodingClient): GeocodingService {
  return {
    async geocode(input: GeocodeInput): Promise<readonly GeocodeHit[]> {
      try {
        if (input.address !== undefined) {
          return await client.forward(input.address, input.limit);
        }
        if (input.lat === undefined || input.lng === undefined) {
          throw new McpError(
            ErrorCodes.InvalidParams,
            "lat and lng are required for reverse geocoding",
          );
        }
        return [await client.reverse({ lat: input.lat, lng: input.lng })];
      } catch (err) {
        throw wrapError(err, ErrorCodes.GeocodingFailed);
      }
    },
  };
}
