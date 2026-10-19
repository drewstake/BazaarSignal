import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { historyDay, type DailyPrice } from "../shared/daily-price-history";

export class HistoryStore {
  readonly db: DatabaseSync;
  constructor(
    path = process.env.PRICE_HISTORY_FILE ?? ".local/price-history.sqlite",
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS daily_prices (
        item TEXT NOT NULL, day INTEGER NOT NULL, source TEXT NOT NULL,
        at INTEGER NOT NULL, buy REAL, sell REAL, reference TEXT NOT NULL,
        PRIMARY KEY(item,day,source)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS history_imports (
        reference TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
        observations INTEGER NOT NULL, days INTEGER NOT NULL, imported_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  imported(reference: string) {
    return !!this.db
      .prepare("SELECT 1 FROM history_imports WHERE reference=?")
      .get(reference);
  }
  save(
    rows: Iterable<DailyPrice>,
    receipt?: {
      reference: string;
      sha256: string;
      bytes: number;
      observations: number;
    },
  ) {
    const write = this.db
      .prepare(`INSERT INTO daily_prices(item,day,source,at,buy,sell,reference) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(item,day,source) DO UPDATE SET at=excluded.at,buy=excluded.buy,sell=excluded.sell,reference=excluded.reference
      WHERE excluded.at>daily_prices.at OR (excluded.at=daily_prices.at AND excluded.reference<daily_prices.reference)`);
    this.db.exec("BEGIN IMMEDIATE");
    let count = 0;
    try {
      for (const r of rows) {
        write.run(r.item, r.day, r.source, r.at, r.buy, r.sell, r.reference);
        count++;
      }
      if (receipt)
        this.db
          .prepare(`INSERT OR REPLACE INTO history_imports VALUES(?,?,?,?,?,?)`)
          .run(
            receipt.reference,
            receipt.sha256,
            receipt.bytes,
            receipt.observations,
            count,
            Date.now(),
          );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return count;
  }
  prices(item: string, now = Date.now()) {
    // Compare actual sample times across sources. Own observations win exact ties,
    // then higher-precision Skytrack, then Bazaar Calc. Keep both sides from one
    // observation: filling a missing side from another time would invent a book.
    return this.db
      .prepare(
        `SELECT day,at,buy,sell,source FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY day ORDER BY at DESC,
        CASE source WHEN 'bazaarsignal' THEN 0 WHEN 'skytrack' THEN 1 ELSE 2 END,reference) AS rank
      FROM daily_prices WHERE item=? AND day<?
    ) WHERE rank=1 ORDER BY day`,
      )
      .all(item, historyDay(now));
  }
  state(key: string): string | undefined {
    return (
      this.db
        .prepare("SELECT value FROM history_state WHERE key=?")
        .get(key) as { value: string } | undefined
    )?.value;
  }
  setState(key: string, value: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO history_state VALUES(?,?)")
      .run(key, JSON.stringify(value));
  }
  claim(key: string): boolean {
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO history_state VALUES(?,?)")
        .run(key, JSON.stringify(Date.now())).changes === 1
    );
  }
  summary() {
    return {
      sources: this.db
        .prepare(
          "SELECT source,COUNT(*) AS itemDays,COUNT(DISTINCT item) AS items,MIN(day) AS firstDay,MAX(day) AS lastDay FROM daily_prices GROUP BY source",
        )
        .all(),
      merged: this.db
        .prepare(
          "SELECT COUNT(*) AS itemDays,COUNT(DISTINCT item) AS items,MIN(day) AS firstDay,MAX(day) AS lastDay FROM (SELECT item,day FROM daily_prices GROUP BY item,day)",
        )
        .get(),
      imports: this.db
        .prepare(
          "SELECT COUNT(*) AS files,SUM(bytes) AS bytes,SUM(observations) AS observations FROM history_imports",
        )
        .get(),
    };
  }
  close() {
    this.db.close();
  }
}
