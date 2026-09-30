import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, createServices, type InfraOverrides } from "../../src/server.js";
import { toolRegistry } from "../../src/tools/index.js";
import type { GeocodingClient } from "../../src/infrastructure/geocodingClient.js";
import type { OsrmClient } from "../../src/infrastructure/osrmClient.js";
import { testConfig } from "../helpers.js";
import { unitSquare } from "../fixtures/coords.js";

const OPEN_WORLD: Record<string, boolean> = {
  optimize_route: true,
  geocode: true,
  distance_matrix: true,
  cluster_points: false,
  boundary_check: false,
  geojson_utils: false,
};

function overrides(): InfraOverrides & { osrm: OsrmClient; geocoding: GeocodingClient } {
  return {
    osrm: {
      table: vi.fn().mockResolvedValue({
        distancesKm: [
          [0, 50],
          [50, 0],
        ],
        durationsMin: [
          [0, 70],
          [70, 0],
        ],
      }),
    },
    geocoding: {
      forward: vi
        .fn()
        .mockResolvedValue([
          { lat: 12.97, lng: 77.59, displayName: "Bengaluru", provider: "nominatim" },
        ]),
      reverse: vi.fn().mockResolvedValue({
        lat: 12.97,
        lng: 77.59,
        displayName: "Bengaluru",
        provider: "nominatim",
      }),
    },
  };
}

function tool(name: string): (typeof toolRegistry)[number] {
  const found = toolRegistry.find((t) => t.name === name);
  if (!found) {
    throw new Error(`missing tool ${name}`);
  }
  return found;
}

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const result = await tool(name).handler(args, createServices(testConfig(), overrides()));
  return { text: result.content[0]?.text ?? "", isError: result.isError === true };
}

function undescribed(schema: unknown, path: string): string[] {
  if (typeof schema !== "object" || schema === null) {
    return [];
  }
  const record = schema as Record<string, unknown>;
  const missing: string[] = [];
  const properties = (record.properties ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(properties)) {
    if (typeof (value as Record<string, unknown>).description !== "string") {
      missing.push(`${path}.${key}`);
    }
    missing.push(...undescribed(value, `${path}.${key}`));
  }
  return missing.concat(undescribed(record.items, `${path}[]`));
}

describe("tool handlers", () => {
  it("registers the six core tools", () => {
    expect(toolRegistry.map((t) => t.name)).toEqual(Object.keys(OPEN_WORLD));
  });

  it("optimizes a route with compact output and no echoed points", async () => {
    const { text, isError } = await call("optimize_route", {
      waypoints: [
        { lat: 0, lng: 0, id: "depot" },
        { lat: 0, lng: 0.3, id: "a" },
      ],
    });
    expect(isError).toBe(false);
    expect(text).not.toContain("\n");
    expect(text).not.toContain('"point"');
    const parsed = JSON.parse(text) as {
      distanceSource: string;
      routes: { stops: { id?: string }[] }[];
    };
    expect(parsed.distanceSource).toBe("haversine");
    expect(parsed.routes[0]?.stops.map((s) => s.id)).toEqual(["depot", "a"]);
  });

  it("reports OSRM distances for useOsrm", async () => {
    const { text } = await call("optimize_route", {
      waypoints: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.1 },
      ],
      closed: false,
      useOsrm: true,
    });
    expect(JSON.parse(text)).toMatchObject({
      distanceSource: "osrm",
      totalDistanceKm: 50,
      totalDurationMin: 70,
    });
  });

  it("returns InvalidParams for bad coordinates and bad time windows", async () => {
    const coords = await call("optimize_route", {
      waypoints: [
        { lat: 1000, lng: 0 },
        { lat: 0, lng: 0 },
      ],
    });
    expect(coords.isError).toBe(true);
    expect(coords.text).toContain('"code":"InvalidParams"');
    const windows = await call("optimize_route", {
      waypoints: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1, readyTimeMin: 30, dueTimeMin: 10 },
      ],
    });
    expect(windows.text).toContain("waypoints.1.readyTimeMin");
  });

  it("geocodes an address via the injected client", async () => {
    const { text, isError } = await call("geocode", { address: "Bengaluru" });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual([
      { lat: 12.97, lng: 77.59, displayName: "Bengaluru", provider: "nominatim" },
    ]);
    expect((await call("geocode", { address: "x", lat: 1 })).text).toContain(
      "lat and lng must be provided together",
    );
  });

  it("computes a distance matrix and rejects oversized requests", async () => {
    const small = await call("distance_matrix", {
      origins: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
      ],
    });
    expect(JSON.parse(small.text)).toMatchObject({
      mode: "haversine",
      distancesKm: [
        [0, 111.195],
        [111.195, 0],
      ],
    });
    const grid = Array.from({ length: 100 }, (_, i) => ({
      lat: (i % 10) * 0.1,
      lng: Math.floor(i / 10) * 0.1,
    }));
    const big = await call("distance_matrix", { origins: grid, destinations: grid });
    expect(big.isError).toBe(true);
    expect(big.text).toContain("10000 cells exceeds the limit of 2500");
  });

  it("clusters points", async () => {
    const { text } = await call("cluster_points", {
      points: unitSquare,
      algorithm: "kmeans",
      k: 2,
      seed: 1,
    });
    const clusters = JSON.parse(text) as { size: number }[];
    expect(clusters.map((c) => c.size).reduce((a, b) => a + b, 0)).toBe(4);
    expect(clusters).toHaveLength(2);
  });

  it("runs boundary checks", async () => {
    const { text } = await call("boundary_check", {
      operation: "bounding_box",
      points: [...unitSquare],
    });
    expect(JSON.parse(text)).toEqual({
      bbox: { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1, crossesAntimeridian: false },
    });
  });

  it("validates geojson recursively", async () => {
    const { text } = await call("geojson_utils", {
      operation: "validate",
      geojson: { type: "Point", coordinates: "banana" },
    });
    expect(JSON.parse(text)).toMatchObject({ valid: false });
  });
});

describe("MCP protocol", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  async function connect(): Promise<Client> {
    const server = createServer(testConfig(), overrides());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "geo-test", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it("publishes self-contained, described schemas with annotations", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual(Object.keys(OPEN_WORLD));
    for (const listed of tools) {
      expect(JSON.stringify(listed.inputSchema)).not.toContain("$ref");
      expect(undescribed(listed.inputSchema, listed.name)).toEqual([]);
      expect(listed.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: OPEN_WORLD[listed.name],
      });
    }
  });

  it("calls tools over the in-memory transport", async () => {
    const called = await (
      await connect()
    ).callTool({
      name: "boundary_check",
      arguments: { operation: "bounding_box", points: [...unitSquare] },
    });
    expect(called.isError).toBeFalsy();
    expect(JSON.stringify(called.content)).toContain("crossesAntimeridian");
  });

  it("surfaces SDK input validation errors as isError results", async () => {
    const result = await (
      await connect()
    ).callTool({
      name: "optimize_route",
      arguments: {
        waypoints: [
          { lat: 1000, lng: 0 },
          { lat: 0, lng: 0 },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(
      /-32602.*Input validation error.*waypoints\[0\]\.lat/,
    );
  });

  it("returns refinement errors in the server's structured format", async () => {
    const grid = Array.from({ length: 60 }, (_, i) => ({ lat: 0, lng: i * 0.01 }));
    const result = await (
      await connect()
    ).callTool({
      name: "distance_matrix",
      arguments: { origins: grid, destinations: grid },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(JSON.parse(content[0]?.text ?? "{}")).toMatchObject({ code: "InvalidParams" });
  });
});
