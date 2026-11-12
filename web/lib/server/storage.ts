import "server-only";
// Where the whole app state is saved.
//   - On Vercel: Upstash Redis (the cloud database). Used whenever its address + token are set.
//   - Local development: a file (.local-data/state.json) so data survives restarts. In tests: plain memory.
// Everything is saved as ONE record, and every change takes a short lock so two visitors can't overwrite each other.
// CONNECT: for a real product, give each table its own storage (Postgres etc.). One record is fine for a prototype.

import { Redis } from "@upstash/redis";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log";

const STATE_KEY = "mosaic:state";
const VERSION_KEY = "mosaic:version";
const LOCK_KEY = "mosaic:lock";
const LOCK_MS = 15_000;
const LOCK_TRIES = 80; // 80 x 100ms: wait up to 8 seconds for another change to finish

export interface Storage {
  kind: "redis" | "memory";
  get(): Promise<unknown | null>;
  save(state: unknown, version: number): Promise<void>;
  clear(): Promise<void>;
  version(): Promise<number>;
  withLock<T>(body: () => Promise<T>): Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function redisConfig() {
  // Vercel's Upstash integration may name them either way.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

function redisStorage(url: string, token: string): Storage {
  const redis = new Redis({ url, token });
  return {
    kind: "redis",
    get: () => redis.get(STATE_KEY),
    async save(state, version) {
      await redis.set(STATE_KEY, state);
      await redis.set(VERSION_KEY, version);
    },
    async clear() {
      await redis.del(STATE_KEY, VERSION_KEY);
    },
    async version() {
      return Number((await redis.get(VERSION_KEY)) ?? 0);
    },
    async withLock(body) {
      const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      let got = false;
      for (let i = 0; i < LOCK_TRIES && !got; i++) {
        got = (await redis.set(LOCK_KEY, token, { nx: true, px: LOCK_MS })) === "OK";
        if (!got) await sleep(100);
      }
      if (!got) throw new Error("The server is busy. Try again in a moment.");
      try {
        return await body();
      } finally {
        if ((await redis.get(LOCK_KEY)) === token) await redis.del(LOCK_KEY);
      }
    },
  };
}

type Mem = { state: unknown | null; version: number; chain: Promise<unknown> };
const g = globalThis as unknown as { __mosaicMem?: Mem };
const FILE = path.join(process.cwd(), ".local-data", "state.json");
const useFile = process.env.NODE_ENV === "development";

function memoryStorage(): Storage {
  const mem = (g.__mosaicMem ??= { state: null, version: 0, chain: Promise.resolve() });
  if (useFile && mem.state === null) {
    try {
      const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
      mem.state = saved.state;
      mem.version = saved.version;
    } catch { /* no saved file yet */ }
  }
  const persist = () => {
    if (!useFile) return;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ state: mem.state, version: mem.version }));
    } catch { /* read-only disk: keep memory only */ }
  };
  return {
    kind: "memory",
    async get() { return mem.state; },
    async save(state, version) { mem.state = structuredClone(state); mem.version = version; persist(); },
    async clear() { mem.state = null; mem.version = 0; persist(); },
    async version() { return mem.version; },
    withLock<T>(body: () => Promise<T>): Promise<T> {
      const run = mem.chain.then(body, body);
      mem.chain = run.catch(() => undefined);
      return run;
    },
  };
}

let cached: Storage | null = null;

export function getStorage(): Storage {
  if (cached) return cached;
  const cfg = redisConfig();
  if (cfg) {
    cached = redisStorage(cfg.url, cfg.token);
  } else if (process.env.NODE_ENV === "production") {
    // Memory on a serverless host would silently forget everything, so refuse loudly instead.
    throw new Error("Cloud storage is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  } else {
    log("warn", "storage_memory", { note: "No Upstash Redis configured: using local storage (development only)" });
    cached = memoryStorage();
  }
  return cached;
}

export function storageKind(): "redis" | "memory" | "missing" {
  if (redisConfig()) return "redis";
  return process.env.NODE_ENV === "production" ? "missing" : "memory";
}
