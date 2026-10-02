import { build } from 'esbuild';
await build({
  entryPoints: ['market-functions/src/index.ts'],
  outfile: 'market-functions/lib/index.cjs', bundle: true, platform: 'node',
  target: 'node24', format: 'cjs',
  external: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],
});
