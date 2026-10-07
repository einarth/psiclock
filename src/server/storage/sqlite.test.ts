import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from './sqlite';
import { initialClock } from '../../shared/clock';
import { defaultStructures } from '../../shared/structures';

describe('SqliteStorage', () => {
  let db: SqliteStorage;
  beforeEach(async () => {
    db = new SqliteStorage(':memory:');
    await db.init();
  });
  afterEach(() => db.close());

  it('creates players with only a name and fills details in later', async () => {
    const p = await db.createPlayer({ name: ' Siggi ', email: '' });
    expect(p).toMatchObject({ name: 'Siggi', fullName: null, email: null, phone: null });
    const u = await db.updatePlayer(p.id, { fullName: 'Sigurður Jónsson', phone: '555 1234' });
    expect(u).toMatchObject({ name: 'Siggi', fullName: 'Sigurður Jónsson', phone: '555 1234', email: null });
    expect(await db.updatePlayer(999, { name: 'x' })).toBeNull();
  });

  it('searches players by any field', async () => {
    await db.createPlayer({ name: 'Anna', email: 'anna@example.is' });
    await db.createPlayer({ name: 'Bjarni', phone: '6612345' });
    expect((await db.listPlayers('example')).map((p) => p.name)).toEqual(['Anna']);
    expect((await db.listPlayers('661')).map((p) => p.name)).toEqual(['Bjarni']);
    expect(await db.listPlayers()).toHaveLength(2);
  });

  it('stores tournaments, their clock and the action log', async () => {
    const s = await db.createStructure(defaultStructures[0]);
    const t = await db.createTournament(
      { name: 'Main event', buyIn: 20000, fee: 2000, startingStack: 30000, levels: s.levels },
      initialClock(1),
    );
    expect(t.status).toBe('setup');
    expect(t.levels).toEqual(s.levels);
    const clock = { ...t.clock, running: true, anchorAt: 5 };
    await db.updateTournamentClock(t.id, clock, 'running');
    expect(await db.getTournament(t.id)).toMatchObject({ status: 'running', clock });
    await db.appendAction({ tournamentId: t.id, type: 'clock.start', payload: { type: 'clock.start' }, actor: 'director' });
    expect((await db.listActions(t.id)).map((a) => a.type)).toEqual(['clock.start']);
  });

  it('keeps data and runs migrations only once when reopened', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'psiclock-')), 'test.db');
    const first = new SqliteStorage(file);
    await first.init();
    await first.createPlayer({ name: 'Anna' });
    await first.close();
    const second = new SqliteStorage(file);
    await second.init();
    expect((await second.listPlayers()).map((p) => p.name)).toEqual(['Anna']);
    await second.close();
  });
});
