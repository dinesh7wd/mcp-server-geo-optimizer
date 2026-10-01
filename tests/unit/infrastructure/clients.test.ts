import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../../src/config.js";
import { LruCache } from "../../../src/infrastructure/cache.js";
import { createGeocodingClient } from "../../../src/infrastructure/geocodingClient.js";
import { createOsrmClient } from "../../../src/infrastructure/osrmClient.js";
import { ErrorCodes } from "../../../src/utils/errors.js";
import { mockHttp, requestedUrl, testConfig } from "../../helpers.js";

const a = { lat: 0, lng: 0 };
const b = { lat: 1, lng: 1 };
const c = { lat: 2, lng: 2 };

function cache(): LruCache {
  return new LruCache(10, 60);
}

describe("osrmClient", () => {
  it("parses a square table, converts units and caches it", async () => {
    const http = mockHttp({
      status: 200,
      body: {
        code: "Ok",
        distances: [
          [0, 500],
          [500, 0],
        ],
        durations: [
          [0, 60],
          [60, 0],
        ],
      },
    });
    const store = cache();
    const client = createOsrmClient(http, testConfig(), store);
    const first = await client.table([a, b]);
    const second = await client.table([a, b]);
    expect(first).toEqual({
      distancesKm: [
        [0, 0.5],
        [0.5, 0],
      ],
      durationsMin: [
        [0, 1],
        [1, 0],
      ],
    });
    expect(second).toBe(first);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(requestedUrl(http)).toBe(
      "http://osrm.test/table/v1/driving/0,0;1,1?annotations=duration,distance",
    );
    expect(store.weight).toBe(8);
  });

  it("requests only origin rows and destination columns", async () => {
    const http = mockHttp({
      status: 200,
      body: { code: "Ok", distances: [[1000, 2000]], durations: [[60, 120]] },
    });
    const table = await createOsrmClient(http, testConfig(), cache()).table([a], [b, c]);
    expect(requestedUrl(http)).toContain(
      "0,0;1,1;2,2?annotations=duration,distance&sources=0&destinations=1;2",
    );
    expect(table).toEqual({ distancesKm: [[1, 2]], durationsMin: [[1, 2]] });
  });

  it("enforces OSRM_MAX_TABLE_SIZE before calling the network", async () => {
    const http = mockHttp();
    const client = createOsrmClient(http, testConfig({ OSRM_MAX_TABLE_SIZE: "2" }), cache());
    await expect(client.table([a, b, c])).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    await expect(client.table([a], [a, b, c])).rejects.toThrow(/OSRM_MAX_TABLE_SIZE=2/);
    expect(http.request).not.toHaveBeenCalled();
  });

  it("reports OSRM error responses with their code and message", async () => {
    const http = mockHttp({
      status: 400,
      body: { code: "TooBig", message: "Too many table coordinates" },
    });
    await expect(createOsrmClient(http, testConfig(), cache()).table([a, b])).rejects.toMatchObject(
      {
        code: ErrorCodes.RouteFail,
        details: { status: 400, code: "TooBig", message: "Too many table coordinates" },
      },
    );
  });

  it("rejects unreachable pairs and malformed matrices", async () => {
    const unreachable = mockHttp({
      status: 200,
      body: {
        code: "Ok",
        distances: [
          [0, null],
          [null, 0],
        ],
        durations: [
          [0, null],
          [null, 0],
        ],
      },
    });
    await expect(
      createOsrmClient(unreachable, testConfig(), cache()).table([a, b]),
    ).rejects.toThrow(/no road route/);
    const wrongSize = mockHttp({
      status: 200,
      body: { code: "Ok", distances: [[0]], durations: [[0]] },
    });
    await expect(
      createOsrmClient(wrongSize, testConfig(), cache()).table([a, b]),
    ).rejects.toMatchObject({
      code: ErrorCodes.RouteFail,
      details: { code: "Ok" },
    });
    const notJson = mockHttp({ status: 502, body: "Bad gateway" });
    await expect(
      createOsrmClient(notJson, testConfig(), cache()).table([a, b]),
    ).rejects.toMatchObject({
      details: { status: 502, code: null, message: null },
    });
  });
});

describe("geocodingClient: nominatim", () => {
  it("parses forward results, sends Accept and caches", async () => {
    const http = mockHttp({
      status: 200,
      body: [{ lat: "1.5", lon: "2.5", display_name: "Somewhere" }],
    });
    const client = createGeocodingClient(http, testConfig(), cache());
    const hits = await client.forward("Main St & 1st", 3);
    await client.forward("Main St & 1st", 3);
    expect(hits).toEqual([{ lat: 1.5, lng: 2.5, displayName: "Somewhere", provider: "nominatim" }]);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(requestedUrl(http)).toBe(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=Main%20St%20%26%201st",
    );
    expect(http.request.mock.calls[0]?.[0].headers).toEqual({ Accept: "application/json" });
  });

  it("fails on error status and on empty results", async () => {
    const failing = createGeocodingClient(
      mockHttp({ status: 500, body: null }),
      testConfig(),
      cache(),
    );
    await expect(failing.forward("x", 1)).rejects.toMatchObject({
      code: ErrorCodes.GeocodingFailed,
      details: { status: 500 },
    });
    const empty = createGeocodingClient(
      mockHttp({ status: 200, body: [{ lat: "x" }] }),
      testConfig(),
      cache(),
    );
    await expect(empty.forward("x", 1)).rejects.toThrow("No geocoding results");
  });

  it("reverse geocodes and caches", async () => {
    const http = mockHttp({ status: 200, body: { lat: 1, lon: 2 } });
    const client = createGeocodingClient(http, testConfig(), cache());
    const hit = await client.reverse({ lat: 1, lng: 2 });
    await client.reverse({ lat: 1, lng: 2 });
    expect(hit).toEqual({ lat: 1, lng: 2, displayName: "1,2", provider: "nominatim" });
    expect(requestedUrl(http)).toBe(
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=1&lon=2",
    );
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("shares one provider request between concurrent identical lookups", async () => {
    const http = mockHttp({ status: 200, body: [{ lat: "1", lon: "2" }] });
    const client = createGeocodingClient(http, testConfig(), cache());
    const [first, second] = await Promise.all([
      client.forward("Same", 1),
      client.forward("Same", 1),
    ]);
    expect(second).toBe(first);
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it("does not cache or keep failed in-flight lookups", async () => {
    const http = mockHttp(
      { status: 500, body: null },
      { status: 200, body: [{ lat: "1", lon: "2" }] },
    );
    const client = createGeocodingClient(http, testConfig(), cache());
    await expect(client.forward("Retry", 1)).rejects.toMatchObject({
      code: ErrorCodes.GeocodingFailed,
    });
    await expect(client.forward("Retry", 1)).resolves.toHaveLength(1);
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it("fails reverse geocoding when Nominatim returns an error body", async () => {
    const http = mockHttp({ status: 200, body: { error: "Unable to geocode" } });
    await expect(createGeocodingClient(http, testConfig(), cache()).reverse(a)).rejects.toThrow(
      "Nominatim reverse geocoding failed",
    );
  });
});

describe("geocodingClient: google", () => {
  const google = (): AppConfig =>
    testConfig({ GEOCODING_PROVIDER: "google", GEOCODING_API_KEY: "abc" });
  const result = (name: string, lat: number): Record<string, unknown> => ({
    formatted_address: name,
    geometry: { location: { lat, lng: 4 } },
  });

  it("respects limit on forward geocoding", async () => {
    const http = mockHttp({
      status: 200,
      body: { status: "OK", results: [result("A", 1), result("B", 2), result("C", 3)] },
    });
    const hits = await createGeocodingClient(http, google(), cache()).forward("X", 2);
    expect(hits.map((h) => h.displayName)).toEqual(["A", "B"]);
    expect(requestedUrl(http)).toContain(
      "maps.googleapis.com/maps/api/geocode/json?address=X&key=abc",
    );
  });

  it("reverse geocodes with latlng and returns the first result", async () => {
    const http = mockHttp({
      status: 200,
      body: { status: "OK", results: [result("First", 1), result("Second", 2)] },
    });
    const hit = await createGeocodingClient(http, google(), cache()).reverse({ lat: 1, lng: 4 });
    expect(hit.displayName).toBe("First");
    expect(requestedUrl(http)).toContain("latlng=1,4&key=abc");
  });

  it("maps ZERO_RESULTS, denied requests and unusable results to GeocodingFailed", async () => {
    const zero = mockHttp({ status: 200, body: { status: "ZERO_RESULTS", results: [] } });
    await expect(createGeocodingClient(zero, google(), cache()).forward("X", 1)).rejects.toThrow(
      "No geocoding results",
    );
    const denied = mockHttp({ status: 200, body: { status: "REQUEST_DENIED" } });
    await expect(
      createGeocodingClient(denied, google(), cache()).forward("X", 1),
    ).rejects.toMatchObject({
      code: ErrorCodes.GeocodingFailed,
      details: { providerStatus: "REQUEST_DENIED" },
    });
    const unusable = mockHttp({
      status: 200,
      body: { status: "OK", results: [{ formatted_address: "X" }] },
    });
    await expect(createGeocodingClient(unusable, google(), cache()).reverse(a)).rejects.toThrow(
      "No geocoding results",
    );
  });

  it("requires an API key", async () => {
    const config: AppConfig = { ...testConfig(), geocodingProvider: "google" };
    await expect(
      createGeocodingClient(mockHttp(), config, cache()).forward("X", 1),
    ).rejects.toMatchObject({
      code: ErrorCodes.ProviderConfig,
    });
  });
});

describe("geocodingClient: mapbox", () => {
  const mapbox = (): AppConfig =>
    testConfig({ GEOCODING_PROVIDER: "mapbox", GEOCODING_API_KEY: "pk.test" });

  it("forward geocodes with limit and an encoded address", async () => {
    const http = mockHttp({
      status: 200,
      body: { features: [{ center: [2.35, 48.85], place_name: "Paris" }, { center: ["x"] }] },
    });
    const hits = await createGeocodingClient(http, mapbox(), cache()).forward("Paris/France", 2);
    expect(hits).toEqual([{ lat: 48.85, lng: 2.35, displayName: "Paris", provider: "mapbox" }]);
    expect(requestedUrl(http)).toBe(
      "https://api.mapbox.com/geocoding/v5/mapbox.places/Paris%2FFrance.json?limit=2&access_token=pk.test",
    );
  });

  it("reverse geocodes using lng,lat order", async () => {
    const http = mockHttp({ status: 200, body: { features: [{ center: [2.35, 48.85] }] } });
    const hit = await createGeocodingClient(http, mapbox(), cache()).reverse({
      lat: 48.85,
      lng: 2.35,
    });
    expect(hit.displayName).toBe("48.85,2.35");
    expect(requestedUrl(http)).toContain("mapbox.places/2.35,48.85.json?limit=1");
  });

  it("fails on error status and empty features", async () => {
    const unauthorized = mockHttp({ status: 401, body: { message: "Not Authorized" } });
    await expect(
      createGeocodingClient(unauthorized, mapbox(), cache()).forward("X", 1),
    ).rejects.toMatchObject({
      details: { status: 401 },
    });
    const empty = mockHttp({ status: 200, body: { features: [] } });
    await expect(createGeocodingClient(empty, mapbox(), cache()).reverse(a)).rejects.toThrow(
      "No geocoding results",
    );
  });
});
