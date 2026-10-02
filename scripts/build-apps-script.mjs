import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('apps-script/build',{recursive:true});
await build({entryPoints:['apps-script/backend.ts'],bundle:true,format:'iife',globalName:'BazaarBackend',target:'es2020',outfile:'apps-script/build/Backend.js'});
await copyFile('apps-script/appsscript.json','apps-script/build/appsscript.json');
await writeFile('apps-script/build/Entrypoints.js', `// Web requests are routed exclusively through doGet/doPost.\nfunction doGet() { return BazaarBackend.doGet(); }\nfunction doPost(e) { return BazaarBackend.doPost(e); }\nfunction scheduledPoll() { return BazaarBackend.scheduledPoll(); }\nfunction installTrigger() { return BazaarBackend.installTrigger(); }\nfunction diagnostics() { return BazaarBackend.diagnostics(); }\nfunction sendTestConfirmation() { return BazaarBackend.sendTestConfirmation(); }\nfunction sendTestTarget() { return BazaarBackend.sendTestTarget(); }\n`);
console.log('Apps Script bundle built (no credentials).');
// Owner runs this configuration action once in the editor for the reviewed release.
const { appendFile } = await import('node:fs/promises');
await appendFile('apps-script/build/Entrypoints.js', 'function configureFreeTierMarket() { return BazaarBackend.configureFreeTierMarket(); }\n');

