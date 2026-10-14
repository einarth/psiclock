/**
 * Entry point of the packaged psiclock.exe (see scripts/package.mjs). The web
 * app is embedded in the exe; the database is a file next to it, so the exe
 * can be replaced with a newer one without touching the data.
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { getAsset } from 'node:sea';

// The built-in SQLite still prints an "experimental" warning on every start; it is not useful to venue staff.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning: string | Error, ...rest: unknown[]) {
  const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
  if (type === 'ExperimentalWarning') return;
  return (emitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
} as typeof process.emitWarning;

const port = Number(process.env.PORT ?? 3000);
const url = `http://localhost:${port}`;

function openBrowser() {
  if (process.platform !== 'win32' || process.env.PSICLOCK_NO_BROWSER === '1') return;
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
}

/** Keeps the window open so the message can be read before it closes. */
function waitAndExit(code: number) {
  console.log('\nPress Enter to close this window.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(code));
}

async function main() {
  const files = new Map<string, Buffer>();
  const list = JSON.parse(Buffer.from(getAsset('web-files.json')).toString('utf8')) as string[];
  for (const path of list) files.set(path, Buffer.from(getAsset(`web/${path}`)));

  // Loaded only now, so the warning filter above is in place before SQLite is.
  const { start } = await import('./start.js');
  try {
    await start({
      port,
      dbFile: resolve(process.env.PSICLOCK_DB ?? join(dirname(process.execPath), 'psiclock.db')),
      webFiles: (path) => files.get(path) ?? null,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.log(`PSICLOCK is already running on this laptop (port ${port} is taken). Opening it in the browser.`);
      openBrowser();
      return waitAndExit(0);
    }
    throw err;
  }
  console.log('\nKeep this window open while the tournament runs. Closing it stops PSICLOCK.');
  openBrowser();
}

main().catch((err) => {
  console.error('PSICLOCK could not start:', err instanceof Error ? err.message : err);
  waitAndExit(1);
});
