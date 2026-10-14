// Builds dist/psiclock.exe (dist/psiclock on Mac or Linux): a copy of the Node.js
// running this script with the server and the web app inside, so the venue laptop
// needs nothing installed. Run `npm run package`, which builds the web app first.
// The database is not inside: the exe keeps it in psiclock.db next to itself.
import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build } from 'esbuild';
import postject from 'postject';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node.js 22.13 or newer is needed to package PSICLOCK; this is ${process.version}.`);
  process.exit(1);
}

const out = 'dist/sea';
const webDir = 'dist/web';
const exe = join('dist', process.platform === 'win32' ? 'psiclock.exe' : 'psiclock');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. The server and everything it uses in one CommonJS file, as Node needs for a single executable.
await build({
  entryPoints: ['src/server/sea.ts'],
  outfile: join(out, 'psiclock.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${major}`,
  // Optional speed-ups the websocket library tries to load; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
});

// 2. The built web app, embedded as assets with a list of their paths.
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(relative(webDir, path).split('\\').join('/'));
  }
};
walk(webDir);
if (!files.includes('index.html')) {
  console.error('dist/web/index.html is missing; run `npm run build` first.');
  process.exit(1);
}
writeFileSync(join(out, 'web-files.json'), JSON.stringify(files));
const assets = { 'web-files.json': join(out, 'web-files.json') };
for (const f of files) assets[`web/${f}`] = join(webDir, f);

const blob = join(out, 'psiclock.blob');
writeFileSync(
  join(out, 'sea-config.json'),
  JSON.stringify({ main: join(out, 'psiclock.cjs'), output: blob, disableExperimentalSEAWarning: true, assets }, null, 2),
);
execFileSync(process.execPath, ['--experimental-sea-config', join(out, 'sea-config.json')], { stdio: 'inherit' });

// 3. A copy of this Node.js with the blob injected.
rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe]);
await postject.inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
});
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);

const mb = (statSync(exe).size / 1024 / 1024).toFixed(0);
console.log(`\nBuilt ${exe} (${mb} MB) with Node.js ${process.version}.`);
console.log('Copy it to the venue laptop and run it. It keeps its data in psiclock.db in the same folder.');
