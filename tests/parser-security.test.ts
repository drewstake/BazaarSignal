import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
it('pins every body-parser copy to a patched compatible branch', () => {
  for (const file of ['package-lock.json', 'market-functions/package-lock.json']) {
    const lock = JSON.parse(readFileSync(file, 'utf8'));
    const parsers = Object.entries(lock.packages).filter(([name]) => name.endsWith('/node_modules/body-parser') || name === 'node_modules/body-parser');
    expect(parsers.length).toBeGreaterThan(0);
    for (const [, value] of parsers) {
      const [major, minor, patch] = (value as any).version.split('.').map(Number);
      expect(major === 1 ? minor > 20 || (minor === 20 && patch >= 9) : major > 2 || (major === 2 && minor >= 4)).toBe(true);
    }
  }
});
it.each(['body-parser', 'firebase-functions/node_modules/body-parser'])('isolates malformed compressed bodies and remains healthy with %s', async name => {
  const parser = name === 'body-parser' ? require.resolve(name) : require.resolve(resolve('node_modules/firebase-functions/node_modules/body-parser'));
  const { stdout } = await promisify(execFile)(process.execPath, [resolve('tests/support/parser-probe.cjs'), parser], { timeout: 7000, windowsHide: true });
  const results = JSON.parse(stdout);
  expect(results).toHaveLength(3);
  for (const result of results) {
    expect(result.valid).toBe(name === 'body-parser' && result.encoding === 'br' ? 400 : 200);
    // Some decompressors ignore a trailer; neither outcome may crash the process.
    expect([200, 400]).toContain(result.malformed);
    expect(result.healthyAfter).toBe(200);
  }
}, 10000);
