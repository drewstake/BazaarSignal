// Offline repository checks. Run from the repository root, after npm run build.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, dirname } from 'node:path';

const root = process.cwd();
const errors = [];
const files = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]) : [];
const requireFile = (path, context) => {
  if (!existsSync(path)) errors.push(`${context}: missing ${relative(root, path)}`);
};
const withoutCode = text => text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
const slug = heading => heading.toLowerCase().replace(/[`*_]/g, '')
  .replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
let links = 0;
const docs = ['README.md', ...files('docs'), ...files('assets/artwork')]
  .filter(path => extname(path) === '.md');
for (const file of docs) {
  const text = withoutCode(readFileSync(file, 'utf8'));
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][\w+.-]*:/i.test(target)) continue;
    const [path, anchor] = target.split('#');
    const destination = path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file);
    links++;
    requireFile(destination, file);
    if (anchor && existsSync(destination) && extname(destination) === '.md') {
      const headings = [...withoutCode(readFileSync(destination, 'utf8')).matchAll(/^#{1,6}\s+(.+)$/gm)]
        .map(m => slug(m[1]));
      if (!headings.includes(decodeURIComponent(anchor))) errors.push(`${file}: missing heading ${target}`);
    }
  }
}

// Literal references plus the actual dynamic icon/item families used by React.
const assets = new Set(['/favicon.svg']);
for (const file of files('src')) {
  if (!/\.(css|tsx?|json)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\/((?:assets|art)\/[\w./-]+\.(?:png|webp|svg|ttf))/g))
    assets.add('/' + match[1]);
}
const components = readFileSync('src/companion/components.tsx', 'utf8');
const iconNames = components.match(/export type SkyIconName =([\s\S]*?);/)?.[1];
if (!iconNames) errors.push('Cannot inspect SkyIconName');
for (const match of (iconNames ?? '').matchAll(/"([\w-]+)"/g))
  for (const size of [64, 128]) assets.add(`/assets/sky-island-v1/web/ui-${match[1]}-${size}.png`);
for (const match of components.matchAll(/file: "(item-[\w-]+)"/g))
  for (const size of [256, 512]) assets.add(`/assets/sky-island-v1/web/${match[1]}-${size}.png`);
const landing = readFileSync('src/companion/NightMarketComponents.tsx', 'utf8');
for (const match of landing.matchAll(/artwork: ["']([\w-]+)["']/g))
  assets.add(`/assets/items/${match[1]}.webp`);
for (const asset of assets) requireFile(resolve('public', '.' + asset), 'runtime asset');

// Every web-sized icon must keep its original; every scene export its PNG input.
for (const file of files('public/assets/sky-island-v1/web')) {
  const name = relative('public/assets/sky-island-v1/web', file).replace(/-\d+\.png$/, '.png');
  requireFile(resolve('assets/artwork/sky-island-v1', name), 'icon generator');
}
for (const name of ['scene-only', 'reference', 'workspace-courtyard'])
  requireFile(resolve(`assets/artwork/night-market/${name}.png`), 'WebP generator');
requireFile(resolve('public/assets/night-market/OFL.txt'), 'font license');

const publicFiles = files('public');
for (const file of publicFiles) {
  const path = relative('public', file).replaceAll('\\', '/');
  if (!/\.(png|webp|svg|ttf)$/.test(path) && path !== 'assets/night-market/OFL.txt')
    errors.push(`Non-runtime public file: ${path}`);
  if (/^assets\/(night-market\/.*\.png|sky-island-v1\/[^/]+)$/.test(path))
    errors.push(`Source artwork in public: ${path}`);
  if (existsSync('dist')) {
    const built = join('dist', path);
    requireFile(built, 'built public asset');
    if (existsSync(built) && !readFileSync(file).equals(readFileSync(built)))
      errors.push(`Build changed public asset bytes: ${path}`);
  }
}
if (existsSync('dist')) {
  for (const file of files('dist')) {
    const path = relative('dist', file).replaceAll('\\', '/');
    if (/\.(zip|md|py|log)$|(?:^|\/)(?:prompts|manifest|verification)\.|preview-.*\.png$/i.test(path))
      errors.push(`Development artifact in build: ${path}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${docs.length} Markdown files / ${links} local links, ${assets.size} runtime paths, source inputs and ${publicFiles.length} public files${existsSync('dist') ? ' including built copies' : ''}.`);
}
