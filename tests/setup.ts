import { afterEach, vi } from "vitest";
import { setLogLevel } from "../src/utils/logger.js";

process.env.GEOCODING_PROVIDER ??= "nominatim";
process.env.LOG_LEVEL ??= "error";
process.env.OSRM_URL ??= "http://osrm.test";
process.env.NODE_ENV ??= "test";
process.env.CACHE_TTL_SECONDS ??= "60";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLogLevel("error");
});
