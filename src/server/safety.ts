import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Storage } from './storage/storage.js';
import { applyClockCommand } from '../shared/clock.js';

/** How often the server notes that it is alive. */
export const HEARTBEAT_MS = 5_000;
/** How often a copy of the database is made while a tournament is running. */
export const BACKUP_EVERY_MS = 10 * 60_000;
/** How many copies to keep in the backups folder. */
export const BACKUPS_KEPT = 30;

export const noteAlive = (storage: Storage, now = Date.now()) => storage.setMeta('lastAlive', String(now));

/**
 * After a power cut, a crash or a restart, pause every running clock at the
 * moment the server was last seen alive, so the time it was down is not
 * taken off the level. Returns the names of the tournaments it paused.
 */
export async function pauseAfterRestart(storage: Storage): Promise<string[]> {
  const lastAlive = Number(await storage.getMeta('lastAlive'));
  if (!lastAlive) return [];
  const paused: string[] = [];
  for (const t of await storage.listTournaments()) {
    if (!t.clock.running) continue;
    const at = Math.max(lastAlive, t.clock.anchorAt);
    await storage.updateTournamentClock(t.id, applyClockCommand(t.levels, t.clock, { type: 'clock.pause' }, at), t.status);
    await storage.appendAction({ tournamentId: t.id, type: 'clock.pauseAfterRestart', payload: { at }, actor: 'server' });
    paused.push(t.name);
  }
  return paused;
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Copies the database into `dir` as psiclock-YYYYMMDD-HHMMSS.db and deletes the oldest copies past `keep`. */
export async function backupDatabase(storage: Storage, dir: string, now = new Date(), keep = BACKUPS_KEPT): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `psiclock-${stamp(now)}.db`);
  await storage.backupTo(file);
  const copies = readdirSync(dir)
    .filter((f) => /^psiclock-\d{8}-\d{6}\.db$/.test(f))
    .sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) rmSync(join(dir, old), { force: true });
  return file;
}
