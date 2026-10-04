import { cpSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

// Firebase CLI can finish an export but fail its final directory rename on
// Windows. Recover only complete exports inside this workspace, without deleting
// the source snapshot or depending on the emulator still running.
export function completedExportTime(directory) {
  try {
    const file = resolve(directory, "firebase-export-metadata.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return saved.firestore?.path === "firestore_export" &&
      saved.firestore.metadata_file === "firestore_export/firestore_export.overall_export_metadata" &&
      existsSync(resolve(directory, saved.firestore.metadata_file))
      ? statSync(file).mtimeMs : 0;
  } catch { return 0; }
}

export function recoverLocalExport(workspace = process.cwd()) {
  const root = resolve(workspace);
  const target = resolve(root, ".local/local-workspace-data");
  const latest = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^firebase-export-\d+[A-Za-z0-9]+$/.test(entry.name))
    .map((entry) => ({ path: resolve(root, entry.name), time: completedExportTime(resolve(root, entry.name)) }))
    .filter((entry) => entry.time > completedExportTime(target))
    .sort((a, b) => b.time - a.time)[0];
  if (!latest) return false;
  if (![latest.path, target].every((path) => path.startsWith(root + sep)))
    throw new Error("Unexpected local export path.");
  cpSync(latest.path, target, { recursive: true, preserveTimestamps: true });
  if (!completedExportTime(target)) throw new Error("Local export recovery is incomplete.");
  return true;
}
