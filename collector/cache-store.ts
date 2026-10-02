import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "redis";

/** A durable CAS plus atomic payload publication. Never emulate this with a process lock. */
export interface CacheStore {
  time?(): Promise<number>;
  read(key: string): Promise<string | null>;
  commit(
    key: string,
    expected: string | null,
    value: string,
    payload?: { key: string; value: string },
  ): Promise<boolean>;
  close(): Promise<void>;
}

/** Local development, or multiple processes on ONE host sharing this exact file. Not NFS. */
export class SqliteCache implements CacheStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }
  async read(key: string) {
    return (
      (
        this.db.prepare("SELECT value FROM cache WHERE key=?").get(key) as
          { value: string } | undefined
      )?.value ?? null
    );
  }
  async commit(
    key: string,
    expected: string | null,
    value: string,
    payload?: { key: string; value: string },
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old =
        (
          this.db.prepare("SELECT value FROM cache WHERE key=?").get(key) as
            { value: string } | undefined
        )?.value ?? null;
      if (old !== expected) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const put = this.db.prepare(
        "INSERT INTO cache VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      );
      put.run(key, value);
      if (payload) put.run(payload.key, payload.value);
      this.db.exec("COMMIT");
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async close() {
    this.db.close();
  }
}

// All keys use one Redis Cluster hash slot. Check-and-publish is a single server operation.
export const CAS_SCRIPT = `
local old = redis.call('GET', KEYS[1])
if (ARGV[1] == 'missing' and old) or (ARGV[1] == 'present' and old ~= ARGV[2]) then return 0 end
if #KEYS == 2 and string.sub(KEYS[1], -7) == 'control' and old then
  local c = cjson.decode(old)
  local t = redis.call('TIME')
  if c.lease and c.lease ~= cjson.null and c.lease['until'] <= tonumber(t[1])*1000 + tonumber(t[2])/1000 then return 0 end
end
redis.call('SET', KEYS[1], ARGV[3])
if #KEYS == 2 then redis.call('SET', KEYS[2], ARGV[4]) end
return 1`;
export async function redisCache(url: string): Promise<CacheStore> {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      reconnectStrategy: (retries) =>
        Math.min(5000, 250 * 2 ** Math.min(retries, 5)) +
        Math.floor(Math.random() * 250),
    },
  });
  client.on("error", () => {
    /* Operations reject; never fall back to an uncoordinated store. */
  });
  await client.connect();
  const key = (s: string) => `{bazaarsignal-market-v1}:${s}`;
  return {
    time: async () => {
      const t = await client.time();
      return Number(t[0]) * 1000 + Number(t[1]) / 1000;
    },
    read: (k) => client.get(key(k)),
    commit: async (k, old, value, payload) =>
      (await client.eval(CAS_SCRIPT, {
        keys: [key(k), ...(payload ? [key(payload.key)] : [])],
        arguments: [
          old === null ? "missing" : "present",
          old ?? "",
          value,
          payload?.value ?? "",
        ],
      })) === 1,
    close: async () => {
      await client.quit();
    },
  };
}
export async function configuredStore(): Promise<CacheStore> {
  if (process.env.MARKET_REDIS_URL)
    return redisCache(process.env.MARKET_REDIS_URL);
  if (
    process.env.NODE_ENV === "production" &&
    process.env.MARKET_STORE !== "sqlite"
  )
    throw new Error(
      "Shared market storage required: configure MARKET_REDIS_URL, or explicitly select single-host MARKET_STORE=sqlite with a persistent local disk.",
    );
  return new SqliteCache(
    process.env.MARKET_CACHE_FILE ?? ".local/current-market.sqlite",
  );
}
