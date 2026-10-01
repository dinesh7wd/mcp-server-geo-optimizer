# mcp-server-geo-optimizer

Model Context Protocol server for geographic and route optimization. It exposes tools for TSP/VRP routing, geocoding, distance matrices, clustering, boundary checks, and GeoJSON utilities.

## Requirements

- Node.js 22+
- Optional: a local [OSRM](https://project-osrm.org/) instance for road-network distances
- Geocoding provider: Nominatim (default), Google, or Mapbox

## Install

```bash
cd mcp-server-geo-optimizer
npm install
npm run build
```

## Cursor MCP config

> **Build first:** Run `npm run build` so the `dist/` folder exists before pointing Cursor at `dist/index.js`.

> **Update the path:** Replace `/path/to/mcp-server-geo-optimizer` below with the absolute path on your machine (e.g. `d:/MCP/mcp-server-geo-optimizer` on Windows or `/home/you/mcp-server-geo-optimizer` on Linux/macOS).

```json
{
  "mcpServers": {
    "geo-optimizer": {
      "command": "node",
      "args": ["/path/to/mcp-server-geo-optimizer/dist/index.js"],
      "env": {
        "GEOCODING_PROVIDER": "nominatim",
        "GEO_USER_AGENT": "my-team-geo/1.0 (contact: you@example.com)",
        "OSRM_URL": "https://router.project-osrm.org"
      }
    }
  }
}
```

After publishing to npm you can switch `command` to `npx` with `args: ["-y", "mcp-server-geo-optimizer"]`.

> **Public APIs:** The default `OSRM_URL` is the [public demo server](https://router.project-osrm.org) and Nominatim is the public [OpenStreetMap geocoder](https://operations.osmfoundation.org/policies/nominatim/). Both have strict usage policies and no SLA. The server spaces requests to these two hosts at least `PUBLIC_API_MIN_INTERVAL_MS` apart (default 1 s), honours `Retry-After`, and sends `GEO_USER_AGENT`. Set `GEO_USER_AGENT` to something that identifies you and includes contact details. For real workloads run your own OSRM (e.g. `http://localhost:5000`) and raise `OSRM_MAX_TABLE_SIZE`.

## Quick test

Once added to Cursor's MCP settings, you can ask:

> "Find the optimal route through these addresses: 123 Main St, 456 Oak Ave, 789 Pine Rd"

Or verify the server starts manually (it listens on stdio; no HTTP port):

```bash
npm run build
node --env-file=.env dist/index.js
```

The server does not load `.env` files itself; use `node --env-file=.env` (Node 22+) or pass variables through your MCP client's `env` block. The process should stay running with no output on stdout. Logs appear as JSON on stderr.

### Docker

The server speaks MCP over stdio, so keep stdin open with `-i`:

```bash
docker build -t mcp-server-geo-optimizer .
docker run -i --rm -e GEOCODING_PROVIDER=nominatim -e GEO_USER_AGENT="my-team-geo/1.0 (contact: you@example.com)" mcp-server-geo-optimizer
```

## Environment

Copy `.env.example` to `.env` to start from documented defaults.

| Variable                     | Required                  | Description                                                                                             |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GEOCODING_PROVIDER`         | No                        | `nominatim` (default), `google`, or `mapbox`                                                            |
| `GEOCODING_API_KEY`          | For `google` and `mapbox` | Provider API key. Redacted from all logs and error messages                                             |
| `GEO_USER_AGENT`             | Recommended               | `User-Agent` sent on every outbound request. Include contact details for Nominatim                      |
| `OSRM_URL`                   | No                        | http(s) OSRM endpoint (default: public demo server)                                                     |
| `OSRM_MAX_TABLE_SIZE`        | No                        | Max coordinates per OSRM table request, checked before any call (default: `100`, the demo server limit) |
| `HAVERSINE_SPEED_KMH`        | No                        | Speed used to convert straight-line km to minutes when OSRM is not used (default: `40`)                 |
| `ROUTE_SEARCH_TIME_BUDGET_MS` | No                       | Wall-clock limit for route local search per request, shared across vehicles (default: `1500`, range 50-30000). The best route found so far is returned when it runs out |
| `PUBLIC_API_MIN_INTERVAL_MS` | No                        | Minimum spacing between requests to the public Nominatim and OSRM hosts, `>= 1000` (default: `1000`)    |
| `HTTP_TIMEOUT_MS`            | No                        | Outbound HTTP timeout per attempt (default: `10000`)                                                    |
| `HTTP_RETRIES`               | No                        | Retries for 5xx, 429, and network errors, `0`-`5` (default: `2`)                                        |
| `CACHE_TTL_SECONDS`          | No                        | In-memory LRU TTL for geocoding and OSRM responses (default: `300`)                                     |
| `LOG_LEVEL`                  | No                        | `debug`, `info`, `warn`, `error` (default: `info`)                                                      |
| `NODE_ENV`                   | No                        | `production` hides unexpected error details from clients (default: `development`)                       |

Logs are written as JSON to **stderr**. stdout is reserved for MCP stdio.

## Tools

All tools are read-only and idempotent. `optimize_route`, `geocode`, and `distance_matrix` may call external services (`openWorldHint: true`); the others are purely local. Results are compact JSON with distances rounded to metres (3 decimals, km), durations to 2 decimals (minutes), and coordinates to 6 decimals.

| Tool              | Purpose                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optimize_route`  | TSP / VRP over 2-200 waypoints (up to `OSRM_MAX_TABLE_SIZE` with `useOsrm: true`). Supports vehicles, capacity, service times, and time windows in minutes. Local search (2-opt, Or-opt, relocate) stops at `ROUTE_SEARCH_TIME_BUDGET_MS`, so large time-window problems can vary slightly between runs. |
| `geocode`         | Forward (`address`, max 500 chars) or reverse (`lat` + `lng` together) geocoding, `limit` 1-10.                                                             |
| `distance_matrix` | Pairwise km and minutes, `mode` `haversine` or `osrm`. At most 100 origins, 100 destinations, and 2,500 cells per request.                                  |
| `cluster_points`  | Deterministic `kmeans` (seeded, k-means++) or `dbscan`, up to 500 points. A `k` larger than the number of distinct points is reduced to that number. Centroids are spherical means, so clusters across the antimeridian work.          |
| `boundary_check`  | `point_in_polygon`, `convex_hull`, `bounding_box`, up to 5,000 points. All handle the antimeridian.                                                         |
| `geojson_utils`   | `validate` (recursive, RFC 7946), `simplify` (keeps altitude, recurses into features and collections), `to_feature_collection`. GeoJSON input max 2 MB.     |

### Routing semantics

- Time is measured in minutes from departure at the depot. Each waypoint may set `readyTimeMin`, `dueTimeMin`, and `serviceTimeMin`. Arriving before `readyTimeMin` waits; `readyTimeMin > dueTimeMin` is rejected.
- Time windows are soft. When no order meets every window, the solver minimises total lateness first, then distance, and reports it instead of failing: each route has a `violations` list, stops carry `lateMin`, and the top-level `feasible` flag is `false`. A `dueTimeMin` on the depot applies to the return leg of closed routes.
- Up to 8 stops per route are solved exactly; larger routes use nearest neighbour with 2-opt and Or-opt improvement.
- With `vehicleCount > 1`, stops are assigned by a sweep around the depot, balanced across vehicles and respecting `capacity`. Stops whose demand cannot fit any vehicle are listed in `unassigned`.
- With `useOsrm: true`, both leg distances and leg durations come from the OSRM table, and `distanceSource` is `osrm`. Otherwise distances are great-circle and durations use `averageSpeedKmh`.

### Bounding boxes

`bounding_box` follows RFC 7946: when points straddle the antimeridian, `minLng` is greater than `maxLng` and `crossesAntimeridian` is `true` (e.g. `minLng: 179.8, maxLng: -179.8`).

## Errors

Invalid arguments are rejected in two stages:

1. **Schema validation by the MCP SDK.** Types, ranges, and required fields are checked before the tool runs. These come back as `isError: true` with plain text, not JSON, for example `MCP error -32602: Input validation error: ...`.
2. **Tool-level checks.** Cross-field rules (such as the distance-matrix cell cap, `startIndex` range, or time-window order) and all runtime failures return `isError: true` with a JSON body `{"code": "...", "message": "..."}`.

| Code              | Meaning                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| `InvalidParams`   | Input failed validation or a request limit                                        |
| `ROUTE_FAIL`      | Routing or distance-matrix operation failed, including OSRM finding no road route |
| `GeocodingFailed` | Geocoding provider returned no results or an error                                |
| `CLUSTER_FAIL`    | Clustering algorithm failed                                                       |
| `GEOMETRY_FAIL`   | Boundary or GeoJSON operation failed                                              |
| `PROVIDER_CONFIG` | Missing or invalid environment configuration                                      |
| `TIMEOUT`         | Outbound HTTP request timed out                                                   |
| `UPSTREAM_ERROR`  | Upstream response was unusable (for example larger than the 5 MB response cap)    |
| `InternalError`   | Unexpected server error                                                           |

API keys and tokens are redacted from every error message and log line. With `NODE_ENV=production`, unexpected errors are reported to clients as `Internal error`, and details stay on stderr.

## Development

This project includes a `.cursorrules` file. Cursor agents automatically follow the coding standards, file structure, and testing rules defined there (layered architecture, strict TypeScript, mocked HTTP in tests, Conventional Commits).

```bash
npm run dev            # run with tsx (stdio)
npm test               # unit + integration tests
npm run test:coverage  # 80% thresholds across src/
npm run typecheck
npm run lint
npm run format:check
dai sunpm run build
```

## Architecture

Layered design: transport → MCP tools → services → pure domain geo algorithms → HTTP adapters. Services never import the MCP SDK. Domain functions are side-effect free and fully unit tested.

## License

MIT
