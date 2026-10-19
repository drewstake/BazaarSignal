import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const source = process.env.PRICE_HISTORY_FILE ?? ".local/price-history.sqlite";
if (!existsSync(source))
  throw new Error("No daily history database to back up");
const folder = resolve(".local/history-backups");
mkdirSync(folder, { recursive: true });
const target = resolve(
  folder,
  `prices-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
);
const database = new DatabaseSync(source);
try {
  database.exec("PRAGMA busy_timeout=5000");
  // SQLite's consistent snapshot includes committed WAL data, unlike copying the main file alone.
  database.prepare("VACUUM INTO ?").run(target);
  console.log(`Daily price history backed up to ${target}`);
} finally {
  database.close();
}
