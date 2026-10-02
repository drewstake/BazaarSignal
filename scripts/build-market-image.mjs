// Local-only, application-only image for Google's managed Node.js 24 base.
// No Google credentials, registry upload, Cloud Build, or deployment is used.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
const require = createRequire(import.meta.url);
// tar is already installed by the pinned firebase-tools development dependency.
const tar = require('tar');
const root = resolve(import.meta.dirname, '..');
const sha = data => createHash('sha256').update(data).digest('hex');
const npmCli = process.env.npm_execpath;
if (!npmCli || !npmCli.endsWith('npm-cli.js'))
  throw new Error('Run through npm run build:market-image so npm uses the current Node runtime');
if (Number(process.versions.node.split('.')[0]) !== 24)
  throw new Error('Build and smoke-test this Node.js 24 application with Node.js 24');

await mkdir(join(root, '.local'), { recursive: true });
const stage = await mkdtemp(join(root, '.local', 'market-image-'));
const workspace = join(stage, 'workspace');
await mkdir(join(workspace, 'lib'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'lib/index.cjs'])
  await copyFile(join(root, 'market-functions', file), join(workspace, file));
const installed = spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts',
  '--no-bin-links', '--no-audit', '--no-fund', '--os=linux', '--cpu=x64'],
{ cwd: workspace, stdio: 'inherit', timeout: 180_000 });
if (installed.error || installed.status !== 0) throw new Error('Local production dependency installation failed');

// Refuse Windows/native binaries and links rather than calling this portable
// merely because npm installed it successfully on the operator's workstation.
const files = [];
async function inventory(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Unexpected image symlink: ${relative(stage, path)}`);
    if (stat.isDirectory()) await inventory(path);
    else {
      if (!stat.isFile() || /\.(node|dll|exe|so|dylib)$/i.test(name))
        throw new Error(`Platform-specific image content: ${relative(stage, path)}`);
      files.push({ path: relative(stage, path).split(sep).join('/'), bytes: stat.size });
    }
  }
}
await inventory(workspace);
if (!files.some(file => file.path === 'workspace/node_modules/@google-cloud/functions-framework/build/src/main.js'))
  throw new Error('Pinned Functions Framework entry point is missing');
const unpackedBytes = files.reduce((sum, file) => sum + file.bytes, 0);
if (unpackedBytes > 128 * 1024 ** 2) throw new Error('Application exceeds the local packaging bound');

const layerPath = join(stage, 'layer.tar');
await tar.c({ cwd: stage, file: layerPath, portable: true, noMtime: true, noDirRecurse: true,
  filter: (_path, stat) => { stat.mode = (stat.mode & ~0o777) | 0o644; return true; } }, files.map(file => file.path));
const layer = await readFile(layerPath), compressed = gzipSync(layer, { level: 9 });
if (compressed.length > 64 * 1024 ** 2) throw new Error('Compressed application exceeds the local packaging bound');
const config = Buffer.from(JSON.stringify({
  architecture: 'amd64', os: 'linux',
  config: { WorkingDir: '/workspace', User: '33:33',
    Env: ['NODE_ENV=production', 'FUNCTION_SIGNATURE_TYPE=http'],
    Entrypoint: ['node', '/workspace/node_modules/@google-cloud/functions-framework/build/src/main.js'] },
  rootfs: { type: 'layers', diff_ids: [`sha256:${sha(layer)}`] },
  history: [{ created_by: 'BazaarSignal local application image; no cloud build' }],
}));
const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: `sha256:${sha(config)}`, size: config.length },
  layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: `sha256:${sha(compressed)}`, size: compressed.length }],
}));
const layout = join(stage, 'oci');
await mkdir(join(layout, 'blobs', 'sha256'), { recursive: true });
for (const value of [compressed, config, manifest])
  await writeFile(join(layout, 'blobs', 'sha256', sha(value)), value, { flag: 'wx' });
await writeFile(join(layout, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
await writeFile(join(layout, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [{
  mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${sha(manifest)}`, size: manifest.length,
  platform: { architecture: 'amd64', os: 'linux' },
}] }));

const receipt = {
  createdAt: new Date().toISOString(), stage, layout,
  imageDigest: `sha256:${sha(manifest)}`, fileCount: files.length,
  sourceSha256: sha(await readFile(join(workspace, 'lib/index.cjs'))),
  lockSha256: sha(await readFile(join(workspace, 'package-lock.json'))),
  unpackedBytes, layerTarBytes: layer.length, compressedLayerBytes: compressed.length,
  registryUploadBytes: compressed.length + config.length + manifest.length,
  // Hold both serialized representations, with extra metadata, instead of
  // assuming registry billing counts only the smaller compressed representation.
  artifactStorageHoldBytes: layer.length + compressed.length + 1024 ** 2,
  cloudBuildMinutes: 0, applicationOnly: true,
  requiredBaseImage: 'us-central1-docker.pkg.dev/serverless-runtimes/google-24-full/runtimes/nodejs24',
  localRuntimeSmokeVerified: false, cloudRuntimeVerified: false, uploaded: false,
};
await writeFile(join(stage, 'receipt.json'), JSON.stringify(receipt, null, 2));
await writeFile(join(stage, 'files.json'), JSON.stringify(files));
console.log(JSON.stringify(receipt, null, 2));
