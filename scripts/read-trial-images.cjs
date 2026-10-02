// Read only the two serving image manifests/configs. Never pull layers, push,
// deploy, or export environment variables. Bound responses and total calls.
const fs = require('node:fs');
const auth = require('firebase-tools/lib/auth');
const { createHash } = require('node:crypto');

(async () => {
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected account unavailable');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const report = { at: new Date().toISOString(), calls: 0, responseBytes: 0, images: {}, errors: [] };
  async function get(url, digest, redirected = false) {
    if (++report.calls > 10) throw new Error('Read budget exhausted');
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' },
      redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get('location');
      await r.body?.cancel();
      const target = location ? new URL(location, url) : null;
      if (digest && !redirected && target && target.origin === new URL(url).origin &&
          target.origin === 'https://us-central1-docker.pkg.dev' && !target.username && !target.password)
        return get(target.href, digest, true);
      throw new Error(`Metadata redirect needs inspection: ${location ? new URL(location, url).origin : 'missing target'}`);
    }
    if (!r.ok) { await r.body?.cancel(); throw new Error(`Metadata read returned ${r.status}`); }
    const chunks = []; let bytes = 0;
    for await (const chunk of r.body) {
      bytes += chunk.length; report.responseBytes += chunk.length;
      if (bytes > 1024 * 1024) throw new Error('Metadata response exceeds 1 MiB hold');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    if (digest && `sha256:${createHash('sha256').update(raw).digest('hex')}` !== digest)
      throw new Error('Content digest mismatch');
    return JSON.parse(raw.toString('utf8'));
  }
  for (const name of ['marketapi', 'refreshmarket']) {
    try {
      const service = await get(`https://run.googleapis.com/v2/projects/bazaarsignal-510305/locations/us-central1/services/${name}`);
      const revision = await get(`https://run.googleapis.com/v2/${service.latestReadyRevision}`);
      const image = revision.containers[0].image;
      const match = /^us-central1-docker\.pkg\.dev\/(bazaarsignal-510305\/gcf-artifacts\/[^@]+)@(sha256:[a-f0-9]{64})$/.exec(image);
      if (!match) throw new Error('Unexpected serving image identity');
      const registry = `https://us-central1-docker.pkg.dev/v2/${match[1]}`;
      const manifest = await get(`${registry}/manifests/${match[2]}`, match[2]);
      if (!/^sha256:[a-f0-9]{64}$/.test(manifest.config?.digest) || !Array.isArray(manifest.layers))
        throw new Error('Unsupported image manifest');
      report.images[name] = {
        image, revision: service.latestReadyRevision,
        buildConfig: service.buildConfig ? {
          baseImage: service.buildConfig.baseImage,
          enableAutomaticUpdates: service.buildConfig.enableAutomaticUpdates,
          functionTarget: service.buildConfig.functionTarget,
        } : null,
        manifest: { mediaType: manifest.mediaType, config: manifest.config, layers: manifest.layers },
      };
      const config = await get(`${registry}/blobs/${manifest.config.digest}`, manifest.config.digest);
      report.images[name].config = { architecture: config.architecture, os: config.os,
          WorkingDir: config.config?.WorkingDir, Entrypoint: config.config?.Entrypoint,
          Cmd: config.config?.Cmd, User: config.config?.User,
          labelNames: Object.keys(config.config?.Labels ?? {}),
      };
    } catch (e) { report.errors.push(`${name}: ${e.message}`); }
  }
  const path = `.local/trial-images-${report.at.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ path, ...report }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
