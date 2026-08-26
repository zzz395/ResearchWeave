interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface BoundedCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

export class BoundedCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor({ maxEntries = 100, ttlMs = 60 * 60 * 1000, now = Date.now }: BoundedCacheOptions = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || ttlMs <= 0) {
      throw new TypeError("Cache bounds must be positive.");
    }
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  get size() {
    return this.entries.size;
  }
}
