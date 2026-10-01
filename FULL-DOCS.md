# mcp-server-geo-optimizer — Full Documentation

> ஒரே இடத்தில்: overview, README, Cursor rules, env, tools, use cases, architecture, error codes.

---

## Table of Contents

1. [Simple Overview (Tanglish)](#1-simple-overview-tanglish)
2. [SEO Use Cases](#2-seo-use-cases)
3. [README — Install & Cursor Config](#3-readme--install--cursor-config)
4. [Environment Variables](#4-environment-variables)
5. [Tools Reference](#5-tools-reference)
6. [Error Codes](#6-error-codes)
7. [Architecture](#7-architecture)
8. [Cursor Rules (`.cursorrules`)](#8-cursor-rules-cursorrules)
9. [Development Blueprint Summary](#9-development-blueprint-summary)
10. [Scripts & License](#10-scripts--license)

---

## 1. Simple Overview (Tanglish)

**mcp-server-geo-optimizer** = AI-ku **map/route help** pannura MCP server.

**Enna use?**

- Address → location find pannum
- Route / best order sollum (delivery, sales visit)
- Distance calculate pannum
- Points-a groups-aa split pannum
- Area inside/outside check pannum

**One-line:** Delivery boy / field visit / location work-ku AI-ku **GPS brain** kudukura server.

**Example Cursor prompt:**

> "Bengaluru, Chennai, Hyderabad — best driving order sollu"

---

## 2. SEO Use Cases

Local SEO / multi-location work-ku location planning help:

| Use case                  | How                                       |
| ------------------------- | ----------------------------------------- |
| Multi-location / branches | Overlap, distance, service area check     |
| Google Business Profile   | Nearby duplicate locations, area clusters |
| Local landing pages       | Cities-a groups-aa split → page strategy  |
| Address cleanup           | Geocode → LocalBusiness schema coords     |
| Site audits               | Best route order for field visits         |
| Competitor mapping        | Cluster competitor locations              |
| Geo content priority      | Distance + clustering for city pages      |

**Note:** Ranking direct improve pannadhu — location data + planning correct pannum.

---

## 3. README — Install & Cursor Config

Model Context Protocol server for geographic and route optimization. Tools: TSP/VRP routing, geocoding, distance matrices, clustering, boundary checks, GeoJSON utilities.

### Requirements

- Node.js 22+
- Optional: local [OSRM](https://project-osrm.org/) for road-network distances
- Geocoding: Nominatim (default), Google, or Mapbox

### Install

```bash
cd mcp-server-geo-optimizer
npm install
npm run build
```

### Cursor MCP config

> **Build first:** Run `npm run build` so `dist/` exists before pointing Cursor at `dist/index.js`.

> **Update the path:** Replace `/path/to/mcp-server-geo-optimizer` with your absolute path (e.g. `d:/MCP/mcp-server-geo-optimizer` on Windows).

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

After npm publish: `"command": "npx"`, `"args": ["-y", "mcp-server-geo-optimizer"]`.

> **Public APIs note:** Default OSRM = [public demo](https://router.project-osrm.org), geocoder = public Nominatim. Rate limits, no SLA. Server spaces requests to these hosts ≥ 1 s apart, honours `Retry-After`, sends `GEO_USER_AGENT`. Production → own OSRM (e.g. `http://localhost:5000`) + higher `OSRM_MAX_TABLE_SIZE`.

Docker (stdio, so `-i` is required):

```bash
docker build -t mcp-server-geo-optimizer .
docker run -i --rm -e GEOCODING_PROVIDER=nominatim -e GEO_USER_AGENT="my-team-geo/1.0 (contact: you@example.com)" mcp-server-geo-optimizer
```

### Quick test

Cursor-la:

> "Find the optimal route through these addresses: 123 Main St, 456 Oak Ave, 789 Pine Rd"

Manual:

```bash
npm run build
node --env-file=.env dist/index.js
```

Server `.env` file-a thaana load pannadhu — `node --env-file=.env` (Node 22+) or MCP client `env` block use pannunga. Process stays running; no stdout chatter. Logs = JSON on **stderr**. stdout = MCP only.

---

## 4. Environment Variables

From `.env.example`:

```env
GEOCODING_PROVIDER=nominatim
# GEOCODING_API_KEY=
GEO_USER_AGENT=mcp-server-geo-optimizer/1.0.0 (contact: you@example.com)
OSRM_URL=https://router.project-osrm.org
OSRM_MAX_TABLE_SIZE=100
HAVERSINE_SPEED_KMH=40
PUBLIC_API_MIN_INTERVAL_MS=1000
HTTP_TIMEOUT_MS=10000
HTTP_RETRIES=2
CACHE_TTL_SECONDS=300
LOG_LEVEL=info
NODE_ENV=production
```

| Variable                     | Required            | Description                                                              |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `GEOCODING_PROVIDER`         | No                  | `nominatim` (default), `google`, or `mapbox`                             |
| `GEOCODING_API_KEY`          | For google / mapbox | API key; redacted from logs and errors                                   |
| `GEO_USER_AGENT`             | Recommended         | Outbound `User-Agent`; include contact details                           |
| `OSRM_URL`                   | No                  | http(s) OSRM endpoint (default: public demo)                             |
| `OSRM_MAX_TABLE_SIZE`        | No                  | Max coordinates per OSRM table call (default: `100`)                     |
| `HAVERSINE_SPEED_KMH`        | No                  | km → minutes speed without OSRM (default: `40`)                          |
| `PUBLIC_API_MIN_INTERVAL_MS` | No                  | Spacing for public Nominatim / OSRM hosts, `>= 1000` (default: `1000`)   |
| `HTTP_TIMEOUT_MS`            | No                  | Outbound timeout per attempt (default: `10000`)                          |
| `HTTP_RETRIES`               | No                  | Retry on 5xx / 429 / network errors, `0`-`5` (default: `2`)              |
| `CACHE_TTL_SECONDS`          | No                  | LRU cache TTL (default: `300`)                                           |
| `LOG_LEVEL`                  | No                  | `debug`, `info`, `warn`, `error` (default: `info`)                       |
| `NODE_ENV`                   | No                  | `production` (default) masks unexpected errors; `development` shows them |

---

## 5. Tools Reference

| Tool              | Purpose                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `optimize_route`  | TSP / VRP (2-200 stops) + vehicles + capacity + time windows (minutes). `useOsrm: true` = road distances and durations |
| `geocode`         | Forward (`address`) or reverse (`lat` + `lng` together), `limit` 1-10                                                  |
| `distance_matrix` | Pairwise km + minutes. `mode`: `haversine` \| `osrm`. Max 2,500 cells                                                  |
| `cluster_points`  | Seeded `kmeans` (k-means++) or `dbscan`, spherical centroids                                                           |
| `boundary_check`  | `point_in_polygon`, `convex_hull`, `bounding_box` (antimeridian-aware, RFC 7946 bbox)                                  |
| `geojson_utils`   | `validate` (recursive), `simplify` (keeps altitude), `to_feature_collection`                                           |

All tools: read-only + idempotent annotations; `openWorldHint` true only for `optimize_route`, `geocode`, `distance_matrix`. Output = compact JSON, rounded (km 3 dp, minutes 2 dp, coords 6 dp).

Time windows are soft: impossible windows → `violations` per route, `lateMin` on stops, `feasible: false` (no throw). `readyTimeMin > dueTimeMin` → `InvalidParams`. Multi-vehicle = balanced sweep around the depot; stops that fit no vehicle → `unassigned`.

---

## 6. Error Codes

SDK schema validation errors come back as plain text (`MCP error -32602: Input validation error: ...`), not JSON. Everything else returns JSON `{"code", "message"}`:

| Code              | Meaning                                            |
| ----------------- | -------------------------------------------------- |
| `InvalidParams`   | Validation failed / request limit exceeded         |
| `ROUTE_FAIL`      | Routing / matrix failed (incl. OSRM no road route) |
| `GeocodingFailed` | Provider error / no results                        |
| `CLUSTER_FAIL`    | Clustering failed                                  |
| `GEOMETRY_FAIL`   | Boundary / GeoJSON failed                          |
| `PROVIDER_CONFIG` | Bad / missing env                                  |
| `TIMEOUT`         | HTTP timeout                                       |
| `UPSTREAM_ERROR`  | Unusable upstream response (e.g. > 5 MB)           |
| `InternalError`   | Unexpected error                                   |

Secrets (API keys, tokens) are redacted in every error and log line. Production: no stack traces to clients. Details → stderr.

---

## 7. Architecture

```
Transport (stdio)
  → MCP Protocol (tools)
    → Services (business logic, no MCP SDK)
      → Domain (pure geo algorithms)
      → Infrastructure (HTTP clients, OSRM, geocoding, LRU cache)
```

**Principles:** single responsibility · pure domain · DI for clients · fail with structured codes · Zod schema-first.

**Stack:** Node 22+ · TypeScript 5.4+ · `@modelcontextprotocol/sdk` · Zod · vitest · eslint + prettier.

---

## 8. Cursor Rules (`.cursorrules`)

Cursor agents must follow:

### Scope

- Only this repo. Never touch sibling projects (e.g. `flowagenz-mcp`).
- One layer at a time: domain → infrastructure → services → tools → server.

### Architecture

- Transport/MCP: `src/index.ts`, `src/server.ts`
- Tools: thin handlers (&lt; 30 lines), schemas only
- Services: no `@modelcontextprotocol/sdk`
- Domain: pure — no HTTP, I/O, MCP
- Inject external clients

### TypeScript

- Strict: `noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes`
- Explicit return types; never `any`; prefer `readonly`
- Functions &lt; 40 lines; one tool per file under `src/tools/`

### Errors

- Tools/services: `McpError`; domain: `DomainError`
- Keep existing `McpError` codes when wrapping (`wrapError`)
- Redact secrets in every error / log line
- Zod validate inputs; fail fast
- No stack leaks in production

### Testing

- Every `src/domain/` file → `tests/unit/domain/`
- Every tool → ≥1 integration test
- Deterministic clustering seeds; mock all HTTP
- ≥80% statements / branches / functions / lines across `src/`

### Logging & commits

- Logs → stderr JSON only
- Branches: `feature/`, `fix/`, `refactor/`
- Conventional Commits: `feat(tools): ...`

---

## 9. Development Blueprint Summary

### File structure

```
mcp-server-geo-optimizer/
├── package.json, tsconfig.json, README.md, LICENSE
├── .cursorrules, .prettierrc, eslint.config.mjs
├── src/
│   ├── index.ts, server.ts, config.ts
│   ├── tools/          # one file per tool
│   ├── services/       # protocol-agnostic logic
│   ├── domain/         # pure geo
│   ├── infrastructure/ # HTTP, OSRM, geocoding, cache
│   └── utils/          # errors, schemas, logger, validators
├── tests/unit|integration|fixtures
└── .github/workflows/ci.yml
```

### Implementation phases (status)

| Phase                         | Status           |
| ----------------------------- | ---------------- |
| 0 Setup / scaffold            | Done             |
| 1 Domain                      | Done             |
| 2 Infrastructure              | Done             |
| 3 Services                    | Done             |
| 4 Tools                       | Done             |
| 5 Integration + tests         | Done (146 tests) |
| 6 Polish (README, CI, errors) | Done             |

### OSRM explained

`https://router.project-osrm.org` = **OSRM public demo** (Open Source Routing Machine). Road-based distance/time. Demo = rate limits; production = own instance.

- **Haversine** = straight-line (air) distance
- **OSRM** = road network routing

---

## 10. Scripts & License

```bash
npm run dev
npm test
npm run test:coverage
npm run lint
npm run build
```

**License:** MIT

**Project path:** `d:\MCP\mcp-server-geo-optimizer`

---

_Generated as a single combined doc from README, .cursorrules, .env.example, and project chat notes._
