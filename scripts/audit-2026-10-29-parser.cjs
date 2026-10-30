// Isolated dependency probe: loopback only, synthetic 33-byte JSON, disposable child.
// Does NOT load the application, credentials, Google clients, or any cloud service.
const { fork } = require('node:child_process');
const { createServer, request } = require('node:http');
const { gzipSync } = require('node:zlib');
const { mkdirSync, writeFileSync } = require('node:fs');
if (process.argv.includes('--child')) {
  const parser = require('../node_modules/firebase-functions/node_modules/body-parser').json();
  const server = createServer((req, res) => parser(req, res, error => {
    res.writeHead(error ? 400 : 200).end(error ? 'Rejected' : 'OK');
  })).listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  setTimeout(() => server.close(() => process.exit(0)), 4000).unref();
} else {
  const child = fork(__filename, ['--child'], { silent: true, windowsHide: true });
  let stderr = '', sent = false, responseStatus = null;
  child.stderr.on('data', data => { stderr += data.toString(); });
  child.on('message', ({ port }) => {
    const compressed = gzipSync(Buffer.from('{"audit":"synthetic-local-only"}'));
    const trailer = Buffer.from('invalid-trailing-data');
    const req = request({ hostname: '127.0.0.1', port, method: 'POST', path: '/',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': compressed.length + trailer.length } }, res => {
      responseStatus = res.statusCode; res.resume();
    });
    req.on('error', () => {});
    req.write(compressed);
    setTimeout(() => { sent = true; req.end(trailer); }, 100);
  });
  const watchdog = setTimeout(() => child.kill(), 6000);
  child.on('exit', (code, signal) => {
    clearTimeout(watchdog);
    const result = { dependency: 'body-parser', version: require('../node_modules/firebase-functions/node_modules/body-parser/package.json').version,
      localOnly: true, sent, responseStatus, exitCode: code, signal, stderr };
    mkdirSync('.local/audit-2026-10-29', { recursive: true });
    writeFileSync('.local/audit-2026-10-29/body-parser-probe.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  });
}
