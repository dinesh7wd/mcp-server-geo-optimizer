export interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
  readonly weight: number;
}

export class LruCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxWeight: number;
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private totalWeight = 0;

  constructor(maxEntries: number, ttlSeconds: number, maxWeight = Number.POSITIVE_INFINITY) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlSeconds * 1000;
    this.maxWeight = maxWeight;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.remove(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, weight = 1): void {
    this.remove(key);
    if (weight > this.maxWeight) {
      return;
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs, weight });
    this.totalWeight += weight;
    this.evict();
  }

  clear(): void {
    this.store.clear();
    this.totalWeight = 0;
  }

  get size(): number {
    return this.store.size;
  }

  get weight(): number {
    return this.totalWeight;
  }

  private remove(key: string): void {
    const entry = this.store.get(key);
    if (entry !== undefined) {
      this.store.delete(key);
      this.totalWeight -= entry.weight;
    }
  }

  private evict(): void {
    while (this.store.size > this.maxEntries || this.totalWeight > this.maxWeight) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.remove(oldest);
    }
  }
}
