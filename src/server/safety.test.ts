import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from './storage/sqlite';
import { backupDatabase, noteAlive, pauseAfterRestart } from './safety';
import { clockAt, initialClock } from '../shared/clock';
import { defaultStructures } from '../shared/structures';

describe('crash safety', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.init();
  });
  afterEach(() => storage.close());

  const tournament = (name: string) =>
    storage.createTournament({ name, buyIn: 0, fee: 0, startingStack: 1000, levels: defaultStructures[0].levels }, initialClock(0));

  it('pauses running clocks where they stood when the server was last alive', async () => {
    const running = await tournament('Running');
    const waiting = await tournament('Not started');
    // Started at 0; the server was last seen at 5 minutes and comes back at 45.
    await storage.updateTournamentClock(running.id, { running: true, levelIndex: 0, elapsedMs: 0, anchorAt: 0 }, 'running');
    await noteAlive(storage, 5 * 60_000);
    expect(await pauseAfterRestart(storage)).toEqual(['Running']);
    const t = (await storage.getTournament(running.id))!;
    expect(t.clock.running).toBe(false);
    expect(t.clock.elapsedMs).toBe(5 * 60_000);
    expect(clockAt(t.levels, t.clock, 45 * 60_000).levelIndex).toBe(0);
    expect((await storage.getTournament(waiting.id))!.clock).toEqual(initialClock(0));
  });

  it('does nothing on the first start, before any heartbeat', async () => {
    const t = await tournament('Running');
    await storage.updateTournamentClock(t.id, { running: true, levelIndex: 0, elapsedMs: 0, anchorAt: 0 }, 'running');
    expect(await pauseAfterRestart(storage)).toEqual([]);
  });

  it('copies the database and keeps only the newest copies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'psiclock-backups-'));
    for (let day = 10; day < 14; day++) writeFileSync(join(dir, `psiclock-202610${day}-120000.db`), '');
    await tournament('Kept');
    const file = await backupDatabase(storage, dir, new Date(2026, 9, 15, 9, 30, 5), 3);
    expect(file.endsWith('psiclock-20261015-093005.db')).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['psiclock-20261012-120000.db', 'psiclock-20261013-120000.db', 'psiclock-20261015-093005.db']);
    const copy = new SqliteStorage(file);
    await copy.init();
    expect((await copy.listTournaments()).map((t) => t.name)).toEqual(['Kept']);
    await copy.close();
  });
});
