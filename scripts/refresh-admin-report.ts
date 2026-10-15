// Historical command retained as a read-only diagnostic. Provider collection is
// exclusively scheduled by the existing Apps Script clock; no force/publish path.
import { readLocalAdmin } from "../server/local-admin";
if (process.argv.slice(2).length)
  throw Error(
    "Admin is clock-driven. Manual refresh/publish options have been removed. Run without options to read the saved snapshot.",
  );
const report = await readLocalAdmin();
console.log(
  JSON.stringify(
    {
      mode: "saved-snapshot-only",
      schedule: "Daily at 12:10 UTC",
      checkedAt: report.checkedAt,
      nextRefreshAt: report.nextRefreshAt,
      pilot: report.pilot,
      email: report.email,
      users: report.users?.total,
      traffic: report.traffic,
      failures: report.failures,
    },
    null,
    2,
  ),
);
