import type { StorageAdapter } from "grammy";
import { RedisSessionStorage, type RedisLike } from "./toolkit/session/redis.js";
import { MemorySessionStorage } from "./toolkit/session/memory.js";

// Durable data storage for user profiles, watchlists, alert rules, and metrics.
// Uses the toolkit's RedisSessionStorage with different key prefixes.
// Falls back to in-memory storage when Redis is not available (dev/test).

// Injectable clock for time-based behavior (testable).
export function now(): Date {
  return new Date();
}

// Redis client singleton (lazy-initialized).
let redisClient: RedisLike | null = null;
let useRedis: boolean | null = null;

async function getRedisClient(): Promise<RedisLike | null> {
  if (useRedis === false) return null;
  if (redisClient) return redisClient;

  const url = typeof process !== "undefined" ? process.env.REDIS_URL : undefined;
  if (!url) {
    useRedis = false;
    return null;
  }

  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ioredis: any = require("ioredis");
    const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
    const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
    redisClient = client as RedisLike;
    useRedis = true;
    return redisClient;
  } catch {
    useRedis = false;
    return null;
  }
}

// Storage adapters for different data types.
async function getStorage<T>(prefix: string): Promise<StorageAdapter<T>> {
  const client = await getRedisClient();
  if (client) {
    return new RedisSessionStorage<T>(client, prefix);
  }
  // Fallback to in-memory storage (for dev/test).
  return new MemorySessionStorage<T>();
}

// ---- Data Types ----

export interface UserProfile {
  chatId: number;
  timezone: string;
  quietHoursStart: string; // HH:MM
  quietHoursEnd: string; // HH:MM
  summaryTime: string; // HH:MM
  summaryEnabled: boolean;
  cooldownMinutes: number;
  onboardedAt: number; // epoch ms
}

export interface WatchlistItem {
  userId: number;
  ticker: string;
  displayName: string;
  coingeckoId: string;
  lastPrice: number | null;
  lastUpdated: number | null; // epoch ms
  addedAt: number; // epoch ms
}

export interface AlertRule {
  id: string;
  userId: number;
  ticker: string;
  alertType: "threshold" | "percentage";
  direction: "above" | "below";
  value: number;
  active: boolean;
  lastFired: number | null; // epoch ms
  createdAt: number; // epoch ms
}

export interface OwnerMetrics {
  totalUsers: number;
  alertTriggers30d: number;
  topAlerts: Array<{ ticker: string; count: number }>;
  lastUpdated: number; // epoch ms
}

// ---- Index Records ----
// We maintain explicit index records to avoid keyspace scans.

interface UserIndex {
  userIds: number[];
}

// ---- Storage Operations ----

export const userStore = {
  async get(userId: number): Promise<UserProfile | null> {
    const storage = await getStorage<UserProfile>("user:");
    const profile = await storage.read(String(userId));
    return profile ?? null;
  },

  async set(userId: number, profile: UserProfile): Promise<void> {
    const storage = await getStorage<UserProfile>("user:");
    await storage.write(String(userId), profile);

    // Update user index.
    const indexStorage = await getStorage<UserIndex>("index:");
    const index = (await indexStorage.read("users")) ?? { userIds: [] };
    if (!index.userIds.includes(userId)) {
      index.userIds.push(userId);
      await indexStorage.write("users", index);
    }
  },

  async delete(userId: number): Promise<void> {
    const storage = await getStorage<UserProfile>("user:");
    await storage.delete(String(userId));

    // Update user index.
    const indexStorage = await getStorage<UserIndex>("index:");
    const index = (await indexStorage.read("users")) ?? { userIds: [] };
    index.userIds = index.userIds.filter((id) => id !== userId);
    await indexStorage.write("users", index);
  },

  async exists(userId: number): Promise<boolean> {
    const storage = await getStorage<UserProfile>("user:");
    const item = await storage.read(String(userId));
    return item !== undefined;
  },

  // For owner metrics — list all user IDs via index.
  async getAllIds(): Promise<number[]> {
    const indexStorage = await getStorage<UserIndex>("index:");
    const index = (await indexStorage.read("users")) ?? { userIds: [] };
    return index.userIds;
  },
};

// ---- Watchlist Index ----
interface WatchlistIndex {
  tickers: string[];
}

export const watchlistStore = {
  async getByUser(userId: number): Promise<WatchlistItem[]> {
    const indexStorage = await getStorage<WatchlistIndex>(`wlidx:${userId}:`);
    const index = (await indexStorage.read("index")) ?? { tickers: [] };

    const items: WatchlistItem[] = [];
    const storage = await getStorage<WatchlistItem>(`wl:${userId}:`);
    for (const ticker of index.tickers) {
      const item = await storage.read(ticker);
      if (item) items.push(item);
    }
    return items;
  },

  async add(item: WatchlistItem): Promise<void> {
    const storage = await getStorage<WatchlistItem>(`wl:${item.userId}:`);
    await storage.write(item.ticker.toLowerCase(), item);

    // Update watchlist index.
    const indexStorage = await getStorage<WatchlistIndex>(`wlidx:${item.userId}:`);
    const index = (await indexStorage.read("index")) ?? { tickers: [] };
    if (!index.tickers.includes(item.ticker.toLowerCase())) {
      index.tickers.push(item.ticker.toLowerCase());
      await indexStorage.write("index", index);
    }
  },

  async remove(userId: number, ticker: string): Promise<void> {
    const storage = await getStorage<WatchlistItem>(`wl:${userId}:`);
    await storage.delete(ticker.toLowerCase());

    // Update watchlist index.
    const indexStorage = await getStorage<WatchlistIndex>(`wlidx:${userId}:`);
    const index = (await indexStorage.read("index")) ?? { tickers: [] };
    index.tickers = index.tickers.filter((t) => t !== ticker.toLowerCase());
    await indexStorage.write("index", index);
  },

  async get(userId: number, ticker: string): Promise<WatchlistItem | null> {
    const storage = await getStorage<WatchlistItem>(`wl:${userId}:`);
    const item = await storage.read(ticker.toLowerCase());
    return item ?? null;
  },

  async updateLastPrice(userId: number, ticker: string, price: number): Promise<void> {
    const storage = await getStorage<WatchlistItem>(`wl:${userId}:`);
    const item = await storage.read(ticker.toLowerCase());
    if (item) {
      item.lastPrice = price;
      item.lastUpdated = now().getTime();
      await storage.write(ticker.toLowerCase(), item);
    }
  },
};

// ---- Alert Index ----
interface AlertIndex {
  alertIds: string[];
}

export const alertStore = {
  async getByUser(userId: number): Promise<AlertRule[]> {
    const indexStorage = await getStorage<AlertIndex>(`aidx:${userId}:`);
    const index = (await indexStorage.read("index")) ?? { alertIds: [] };

    const items: AlertRule[] = [];
    const storage = await getStorage<AlertRule>(`alert:${userId}:`);
    for (const id of index.alertIds) {
      const item = await storage.read(id);
      if (item) items.push(item);
    }
    return items;
  },

  async add(alert: AlertRule): Promise<void> {
    const storage = await getStorage<AlertRule>(`alert:${alert.userId}:`);
    await storage.write(alert.id, alert);

    // Update alert index.
    const indexStorage = await getStorage<AlertIndex>(`aidx:${alert.userId}:`);
    const index = (await indexStorage.read("index")) ?? { alertIds: [] };
    if (!index.alertIds.includes(alert.id)) {
      index.alertIds.push(alert.id);
      await indexStorage.write("index", index);
    }
  },

  async remove(userId: number, alertId: string): Promise<void> {
    const storage = await getStorage<AlertRule>(`alert:${userId}:`);
    await storage.delete(alertId);

    // Update alert index.
    const indexStorage = await getStorage<AlertIndex>(`aidx:${userId}:`);
    const index = (await indexStorage.read("index")) ?? { alertIds: [] };
    index.alertIds = index.alertIds.filter((id) => id !== alertId);
    await indexStorage.write("index", index);
  },

  async updateLastFired(userId: number, alertId: string): Promise<void> {
    const storage = await getStorage<AlertRule>(`alert:${userId}:`);
    const alert = await storage.read(alertId);
    if (alert) {
      alert.lastFired = now().getTime();
      await storage.write(alertId, alert);
    }
  },

  async getAllActive(): Promise<AlertRule[]> {
    // For alert evaluation — iterate all users' alerts via index.
    const userIds = await userStore.getAllIds();
    const allAlerts: AlertRule[] = [];
    for (const userId of userIds) {
      const alerts = await this.getByUser(userId);
      allAlerts.push(...alerts.filter((a) => a.active));
    }
    return allAlerts;
  },
};

export const metricsStore = {
  async get(): Promise<OwnerMetrics> {
    const storage = await getStorage<OwnerMetrics>("metrics:");
    const metrics = await storage.read("owner");
    return metrics ?? { totalUsers: 0, alertTriggers30d: 0, topAlerts: [], lastUpdated: now().getTime() };
  },

  async set(metrics: OwnerMetrics): Promise<void> {
    const storage = await getStorage<OwnerMetrics>("metrics:");
    await storage.write("owner", metrics);
  },

  async incrementAlertTriggers(): Promise<void> {
    const metrics = await this.get();
    metrics.alertTriggers30d++;
    metrics.lastUpdated = now().getTime();
    await this.set(metrics);
  },
};
