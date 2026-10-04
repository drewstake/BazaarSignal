// Inspect/extract our local OCI artifact, then boot both exported handlers with
// all outbound connections blocked. No handler request or Google call is made.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
const tar = createRequire(import.meta.url)('tar');
const root = resolve(import.meta.dirname, '..'), stage = resolve(process.argv[2] ?? '');
if (!stage.startsWith(join(root, '.local', 'market-image-')) ||
    stage.slice(join(root, '.local').length + 1).includes(sep))
  throw new Error('Pass a generated .local/market-image-* directory');
const receiptPath = join(stage, 'receipt.json');
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
const blob = async digest => {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid artifact digest');
  const bytes = await readFile(join(stage, 'oci', 'blobs', 'sha256', digest.slice(7)));
  if (`sha256:${sha(bytes)}` !== digest) throw new Error('Artifact digest mismatch');
  return bytes;
};
const manifest = JSON.parse(await blob(receipt.imageDigest));
const config = JSON.parse(await blob(manifest.config.digest));
if (manifest.layers.length !== 1 || config.os !== 'linux' || config.architecture !== 'amd64' ||
    config.config.WorkingDir !== '/workspace' || config.config.User !== '33:33' ||
    JSON.stringify(config.config.Entrypoint) !== JSON.stringify(['node', '/workspace/node_modules/@google-cloud/functions-framework/build/src/main.js']))
  throw new Error('Application image contract mismatch');
const layer = await blob(manifest.layers[0].digest), uncompressed = gunzipSync(layer);
if (`sha256:${sha(uncompressed)}` !== config.rootfs.diff_ids[0] ||
    layer.length !== manifest.layers[0].size || uncompressed.length !== receipt.layerTarBytes)
  throw new Error('Layer content does not match the image manifest and receipt');
const inventory = JSON.parse(await readFile(join(stage, 'files.json'), 'utf8'));
const expected = new Map(inventory.map(file => [file.path, file.bytes]));
const archive = join(stage, 'oci', 'blobs', 'sha256', manifest.layers[0].digest.slice(7));
await tar.t({ file: archive, strict: true, onReadEntry(entry) {
  if (entry.type !== 'File' || !entry.path.startsWith('workspace/') || entry.path.includes('..') ||
      entry.mode !== 0o644 || !expected.has(entry.path) || expected.get(entry.path) !== entry.size)
    throw new Error(`Unexpected archive entry: ${entry.path}`);
  expected.delete(entry.path);
} });
if (expected.size) throw new Error('Application files missing from the archive');
const extraction = await mkdtemp(join(stage, 'verify-'));
await tar.x({ cwd: extraction, file: archive, strict: true, preservePaths: false });
const cwd = join(extraction, 'workspace');
if (sha(await readFile(join(cwd, 'lib', 'index.cjs'))) !== receipt.sourceSha256 ||
    sha(await readFile(join(cwd, 'package-lock.json'))) !== receipt.lockSha256)
  throw new Error('Extracted code or dependency lock differs from the measured build');
const guard = join(extraction, 'deny-network.cjs');
await writeFile(guard, "const deny=()=>{throw new Error('Outbound network forbidden during image smoke test')}; require('node:net').Socket.prototype.connect=deny; globalThis.fetch=deny;\n");
for (const target of ['marketApi', 'refreshMarket']) {
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--require', guard, 'node_modules/@google-cloud/functions-framework/build/src/main.js'], {
      cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        NODE_ENV: 'test', PORT: '0', FUNCTION_TARGET: target, FUNCTION_SIGNATURE_TYPE: 'http',
        GCLOUD_PROJECT: 'bazaarsignal-510305', MARKET_OPERATING_MODE: 'free-tier' },
    });
    let output = '', ready = false;
    const timeout = setTimeout(() => { child.kill(); fail(new Error(`${target} startup timed out: ${output}`)); }, 15000);
    child.on('error', error => { clearTimeout(timeout); fail(error); });
    const append = chunk => {
      output += chunk.toString();
      if (output.length > 16000) { child.kill(); fail(new Error('Startup output exceeded bound')); }
      if (output.includes(`Function: ${target}`) && output.includes('URL: http://localhost:0/')) {
        ready = true;
        child.kill();
      }
    };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('close', () => {
      clearTimeout(timeout);
      if (!ready || output.includes('Outbound network forbidden')) fail(new Error(`${target} startup failed: ${output}`));
      else done();
    });
  });
}
receipt.localRuntimeSmokeVerified = true;
receipt.localRuntimeSmokePlatform = `${process.platform}/${process.arch} Node ${process.version}`;
receipt.localRuntimeSmokeVerifiedAt = new Date().toISOString();
receipt.localRuntimeSmoke = { handlers: ['marketApi', 'refreshMarket'], operatingMode: 'free-tier', outboundConnections: 'blocked', handlerRequests: 0 };
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
