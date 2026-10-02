// Read only the currently deployed Functions source identities and the three
// code/package files needed to verify historical Firestore access paths.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { unzipSync } = require('fflate');
const auth = require('firebase-tools/lib/auth');
(async () => {
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const receipt = { at: new Date().toISOString(), calls: 0, responseBytes: 0, sources: {} };
  const stage = fs.mkdtempSync(path.resolve('.local', 'deployed-market-source-'));
  async function get(url, limit) {
    if (++receipt.calls > 4) throw new Error('Read-only call budget exhausted');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` },
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok) { await r.body?.cancel(); throw new Error(`Source read HTTP ${r.status}`); }
    const parts = []; let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length; receipt.responseBytes += chunk.length;
      if (size > limit) throw new Error('Source response exceeded read bound');
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  }
  for (const name of ['marketApi', 'refreshMarket']) {
    const metadata = JSON.parse(await get(`https://cloudfunctions.googleapis.com/v2/projects/bazaarsignal-510305/locations/us-central1/functions/${name}`, 1024 ** 2));
    const source = metadata.buildConfig?.source?.storageSource;
    if (source?.bucket !== 'gcf-v2-sources-1081657730748-us-central1' || source.object !== `${name}/function-source.zip` || !/^\d+$/.test(source.generation))
      throw new Error('Unexpected current deployed source identity');
    const zip = await get(`https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`, 1024 ** 2);
    const allowed = ['lib/index.cjs', 'package.json', 'package-lock.json'];
    const entries = unzipSync(zip, { filter: entry => allowed.includes(entry.name) && entry.originalSize < 1024 ** 2 });
    const result = { source, zipBytes: zip.length, zipSha256: crypto.createHash('sha256').update(zip).digest('hex'), files: {} };
    for (const nameInZip of allowed) {
      const value = entries[nameInZip];
      if (!value) throw new Error(`Required code/package entry missing: ${nameInZip}`);
      const target = path.join(stage, name, nameInZip);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value, { flag: 'wx' });
      result.files[nameInZip] = { bytes: value.length, sha256: crypto.createHash('sha256').update(value).digest('hex') };
    }
    receipt.sources[name] = result;
  }
  fs.writeFileSync(path.join(stage, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ stage, ...receipt }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
