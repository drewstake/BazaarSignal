// Disposable loopback process. No app, identity, cloud client or real data.
const { createServer, request } = require('node:http');
const { gzipSync, deflateSync, brotliCompressSync } = require('node:zlib');
const parser = require(process.argv[2]).json();
const server = createServer((req, res) => parser(req, res, error => {
  res.writeHead(error ? 400 : 200).end(error ? 'Rejected' : JSON.stringify(req.body));
}));
const watchdog = setTimeout(() => process.exit(2), 5000);
server.listen(0, '127.0.0.1', async () => {
  const send = (encoding, packed, trailer) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding, 'Content-Length': packed.length + trailer.length } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.write(packed); setTimeout(() => req.end(trailer), 10);
  });
  try {
    const results = [];
    for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]]) {
      const body = compress(Buffer.from('{"test":true}'));
      results.push({ encoding, valid: await send(encoding, body, Buffer.alloc(0)),
        malformed: await send(encoding, body, Buffer.from('invalid-trailing-data')),
        healthyAfter: await send('gzip', gzipSync(Buffer.from('{"test":true}')), Buffer.alloc(0)) });
    }
    process.stdout.write(JSON.stringify(results));
  } catch (error) { process.stderr.write(String(error)); process.exitCode = 1; }
  finally { clearTimeout(watchdog); server.close(); }
});
