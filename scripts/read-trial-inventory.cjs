// Read-only capacity and permission evidence. Storage object listings are Class A
// operations, recorded here explicitly. No data, IAM or resource mutation.
const fs = require("node:fs"),
  auth = require("firebase-tools/lib/auth");
(async () => {
  const project = "bazaarsignal-510305",
    root = `projects/${project}`,
    region = `${root}/locations/us-central1`;
  const account = auth
    .getAllAccounts()
    .find((a) => a.user.email === "drewstake3@gmail.com");
  if (!account) throw new Error("Expected account unavailable");
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const evidence = {
    at: new Date().toISOString(),
    apiCalls: 0,
    objectListPages: 0,
    objects: {},
    errors: [],
  };
  async function call(url, body) {
    if (++evidence.apiCalls > 32) throw new Error('Inventory read budget reached');
    const r = await fetch(url, {
      method: body ? "POST" : "GET",
      redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`${r.status}: ${data.error?.message}`);
    return data;
  }
  async function pages(url, key) {
    const result = [];
    let pageToken;
    do {
      const q = new URL(url);
      if (pageToken) q.searchParams.set("pageToken", pageToken);
      const page = await call(q);
      result.push(...(page[key] ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }
  const buckets = await pages(
    `https://storage.googleapis.com/storage/v1/b?project=${project}`,
    "items",
  );
  for (const bucket of buckets) {
    evidence.objects[bucket.name] = { liveAndVersions: [], softDeleted: [] };
    for (const mode of ["versions", "softDeleted"]) {
      if (
        mode === "softDeleted" &&
        Number(bucket.softDeletePolicy?.retentionDurationSeconds ?? 0) === 0
      )
        continue;
      try {
        let pageToken;
        do {
          const q = new URLSearchParams({
            [mode]: "true",
            maxResults: "1000",
            fields:
              "items(name,generation,size,timeCreated,softDeleteTime,hardDeleteTime),nextPageToken",
            ...(pageToken ? { pageToken } : {}),
          });
          evidence.objectListPages++;
          const page = await call(
            `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket.name)}/o?${q}`,
          );
          evidence.objects[bucket.name][
            mode === "versions" ? "liveAndVersions" : "softDeleted"
          ].push(...(page.items ?? []));
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (error) {
        evidence.errors.push(`${bucket.name}/${mode}: ${error.message}`);
      }
    }
  }
  for (const [key, url, body] of [
    [
      "iam",
      `https://cloudresourcemanager.googleapis.com/v1/${root}:getIamPolicy`,
      { options: { requestedPolicyVersion: 3 } },
    ],
    [
      "firestoreIndexes",
      `https://firestore.googleapis.com/v1/${root}/databases/(default)/collectionGroups/-/indexes`,
    ],
    [
      "firestoreFields",
      `https://firestore.googleapis.com/v1/${root}/databases/(default)/collectionGroups/marketCache/fields/value`,
    ],
    [
      "firestoreBackups",
      `https://firestore.googleapis.com/v1/${region}/backups`,
    ],
    [
      "artifactImages",
      `https://artifactregistry.googleapis.com/v1/${region}/repositories/gcf-artifacts/dockerImages?pageSize=1000`,
    ],
  ]) {
    try {
      evidence[key] = await call(url, body);
      if (evidence[key].nextPageToken)
        evidence.errors.push(`${key}: incomplete pagination`);
    } catch (error) {
      evidence.errors.push(`${key}: ${error.message}`);
    }
  }
  if (evidence.iam)
    evidence.iam = {
      version: evidence.iam.version,
      bindings: (evidence.iam.bindings ?? []).filter((b) =>
        b.members.some(
          (m) =>
            m.includes(`market-reader@${project}`) ||
            m.includes(`market-collector@${project}`),
        ),
      ),
    };
  const reportPath = `.local/trial-inventory-${evidence.at.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(
    reportPath,
    JSON.stringify(evidence, null, 2),
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify(
      {
        at: evidence.at,
        path: reportPath,
        apiCalls: evidence.apiCalls,
        objectListPages: evidence.objectListPages,
        capacityBytes: Object.fromEntries(
          Object.entries(evidence.objects).map(([k, v]) => [
            k,
            Object.fromEntries(
              Object.entries(v).map(([state, items]) => [
                state,
                items.reduce((n, item) => n + Number(item.size), 0),
              ]),
            ),
          ]),
        ),
        iam: evidence.iam,
        errors: evidence.errors,
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
