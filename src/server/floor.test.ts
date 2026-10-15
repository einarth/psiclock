import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { SqliteStorage } from './storage/sqlite';
import { signedIn } from './testing';
import { defaultStructures } from '../shared/structures';
import type { Entry } from '../shared/types';

describe('floor actions', () => {
  let app: FastifyInstance;
  let storage: SqliteStorage;
  let tid: number;
  let cookie: string;

  const post = async (url: string, payload?: object) => {
    const res = await app.inject({ method: 'POST', url, payload: payload ?? {}, headers: { cookie } });
    return { status: res.statusCode, body: res.json() };
  };
  const entries = async () => (await app.inject({ url: `/api/tournaments/${tid}/entries` })).json() as Entry[];

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.init();
    const s = await storage.createStructure(defaultStructures[0]);
    app = await buildApp({ storage });
    cookie = await signedIn(storage);
    const t = await post('/api/tournaments', { name: 'Test', structureId: s.id, tableCount: 2, seatsPerTable: 3, startingStack: 1000 });
    tid = t.body.id;
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      const p = await post('/api/players', { name });
      await post(`/api/tournaments/${tid}/entries`, { playerId: p.body.id });
    }
  });
  afterEach(async () => {
    await app.close();
    await storage.close();
  });

  it('seats players and refuses when the room is full', async () => {
    const list = await entries();
    const counts = [1, 2].map((n) => list.filter((e) => e.table === n).length);
    expect(counts.sort()).toEqual([2, 3]);
    const p = await post('/api/players', { name: 'F' });
    expect((await post(`/api/tournaments/${tid}/entries`, { playerId: p.body.id })).status).toBe(201);
    const g = await post('/api/players', { name: 'G' });
    const full = await post(`/api/tournaments/${tid}/entries`, { playerId: g.body.id });
    expect(full.status).toBe(400);
    expect(full.body.error).toMatch(/add a table/);
    await post(`/api/tournaments/${tid}/tables`, {});
    expect((await post(`/api/tournaments/${tid}/entries`, { playerId: g.body.id })).status).toBe(201);
  });

  it('busts players with the right place and puts them back on undo', async () => {
    const [a, b] = await entries();
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/bust`)).body.place).toBe(5);
    expect((await post(`/api/tournaments/${tid}/entries/${b.id}/bust`)).body.place).toBe(4);
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/bust`)).status).toBe(400);
    const back = await post(`/api/tournaments/${tid}/entries/${a.id}/restore`);
    expect(back.body).toEqual({ table: a.table, seat: a.seat });
    const actions = (await app.inject({ url: `/api/tournaments/${tid}/actions`, headers: { cookie } })).json();
    expect(actions.map((x: { type: string }) => x.type)).toContain('entry.restore');
  });

  it('finishes the tournament and stops the clock when one player is left', async () => {
    await post(`/api/tournaments/${tid}/clock`, { type: 'clock.start' });
    const list = await entries();
    for (const e of list.slice(0, 3)) expect((await post(`/api/tournaments/${tid}/entries/${e.id}/bust`)).body.finished).toBe(false);
    const last = await post(`/api/tournaments/${tid}/entries/${list[3].id}/bust`);
    expect(last.body).toEqual({ place: 2, finished: true });
    let t = (await storage.getTournament(tid))!;
    expect(t.status).toBe('finished');
    expect(t.clock.running).toBe(false);
    expect((await post(`/api/tournaments/${tid}/entries/${list[4].id}/bust`)).status).toBe(400);
    // Undoing that bust reopens it; the clock waits for the director.
    await post(`/api/tournaments/${tid}/entries/${list[3].id}/restore`);
    t = (await storage.getTournament(tid))!;
    expect(t.status).toBe('running');
    expect(t.clock.running).toBe(false);
  });

  it('ends a running tournament with players left for a deal, and reopens it', async () => {
    expect((await post(`/api/tournaments/${tid}/finish`, { finished: true })).status).toBe(400);
    await post(`/api/tournaments/${tid}/clock`, { type: 'clock.start' });
    expect((await post(`/api/tournaments/${tid}/finish`, { finished: true })).body).toEqual({ finished: true, playersLeft: 5 });
    let t = (await storage.getTournament(tid))!;
    expect([t.status, t.clock.running]).toEqual(['finished', false]);
    expect((await post(`/api/tournaments/${tid}/clock`, { type: 'clock.start' })).status).toBe(400);
    const [a] = await entries();
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/bust`)).status).toBe(400);
    await post(`/api/tournaments/${tid}/finish`, { finished: false });
    t = (await storage.getTournament(tid))!;
    expect([t.status, t.clock.running]).toEqual(['running', false]);
  });

  it('deletes a tournament with its entries and log', async () => {
    const floor = await signedIn(storage, 'floor');
    const del = (cookie: string) => app.inject({ method: 'DELETE', url: `/api/tournaments/${tid}`, headers: { cookie } });
    expect((await del(floor)).statusCode).toBe(403);
    expect((await del(cookie)).statusCode).toBe(204);
    expect(await storage.getTournament(tid)).toBeNull();
    expect(await storage.listEntries(tid)).toEqual([]);
    expect((await del(cookie)).statusCode).toBe(404);
  });

  it('moves a player to a chosen table and rejects a taken seat', async () => {
    const list = await entries();
    // Move from the full table (3 players) to the short one (2 players).
    const full = list.filter((e) => e.table === 1).length === 3 ? 1 : 2;
    const short = full === 1 ? 2 : 1;
    const from = list.find((e) => e.table === full)!;
    const taken = list.find((e) => e.table === short)!;
    expect((await post(`/api/tournaments/${tid}/entries/${from.id}/move`, { table: short, seat: taken.seat })).status).toBe(400);
    const moved = await post(`/api/tournaments/${tid}/entries/${from.id}/move`, { table: short });
    expect(moved.body.table).toBe(short);
    expect((await post(`/api/tournaments/${tid}/entries/${from.id}/move`, { table: full + 5 })).status).toBe(400);
  });

  it('breaks a table and closes it', async () => {
    const list = await entries();
    await post(`/api/tournaments/${tid}/entries/${list[0].id}/bust`);
    await post(`/api/tournaments/${tid}/entries/${list[1].id}/bust`);
    const res = await post(`/api/tournaments/${tid}/tables/2/break`);
    expect(res.status).toBe(200);
    const alive = (await entries()).filter((e) => e.bustSeq === null);
    expect(alive.every((e) => e.table === 1)).toBe(true);
    expect(new Set(alive.map((e) => e.seat)).size).toBe(alive.length);
    const t = await storage.getTournament(tid);
    expect(t!.tables.find((x) => x.number === 2)!.open).toBe(false);
  });

  it('redraws seats without clashing and toggles hand-for-hand', async () => {
    expect((await post(`/api/tournaments/${tid}/tables/2/redraw`)).status).toBe(200);
    const two = (await entries()).filter((e) => e.table === 2);
    expect(new Set(two.map((e) => e.seat)).size).toBe(two.length);
    await post(`/api/tournaments/${tid}/hand-for-hand`, { on: true });
    expect((await storage.getTournament(tid))!.handForHand).toBe(true);
  });

  it('pauses the clock for hand-for-hand when asked and restarts it afterwards', async () => {
    await post(`/api/tournaments/${tid}/clock`, { type: 'clock.start' });
    expect((await post(`/api/tournaments/${tid}/hand-for-hand`, { on: true, pauseClock: true })).body.clock).toBe('paused');
    let t = (await storage.getTournament(tid))!;
    expect(t.handForHand).toBe(true);
    expect(t.clock.running).toBe(false);
    expect((await post(`/api/tournaments/${tid}/hand-for-hand`, { on: false })).body.clock).toBe('resumed');
    t = (await storage.getTournament(tid))!;
    expect(t.handForHand).toBe(false);
    expect(t.clock.running).toBe(true);
    // Without pauseClock the clock keeps running.
    expect((await post(`/api/tournaments/${tid}/hand-for-hand`, { on: true })).body.clock).toBe('unchanged');
    expect((await storage.getTournament(tid))!.clock.running).toBe(true);
  });

  it('lets floor staff pause and resume the clock but not start the tournament', async () => {
    const floor = await signedIn(storage, 'floor');
    const run = async (running: boolean) =>
      app.inject({ method: 'POST', url: `/api/tournaments/${tid}/clock/run`, payload: { running }, headers: { cookie: floor } });
    expect((await run(true)).statusCode).toBe(400);
    const start = await app.inject({ method: 'POST', url: `/api/tournaments/${tid}/clock`, payload: { type: 'clock.start' }, headers: { cookie: floor } });
    expect(start.statusCode).toBe(403);
    await post(`/api/tournaments/${tid}/clock`, { type: 'clock.start' });
    expect((await run(false)).statusCode).toBe(200);
    expect((await storage.getTournament(tid))!.clock.running).toBe(false);
    expect((await run(true)).statusCode).toBe(200);
    expect((await storage.getTournament(tid))!.clock.running).toBe(true);
  });

  it('saves a tournament as a template and starts a new one from it', async () => {
    await app.inject({ method: 'PATCH', url: `/api/tournaments/${tid}`, payload: { buyIn: 15000, payouts: [60, 40] }, headers: { cookie } });
    const saved = await post('/api/templates', { name: 'Monday', tournamentId: tid });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ name: 'Monday', buyIn: 15000, tableCount: 2, seatsPerTable: 3, payouts: [60, 40] });
    // Saving again under the same name replaces it.
    expect((await post('/api/templates', { name: 'monday', tournamentId: tid })).body.id).toBe(saved.body.id);
    const t = await post('/api/tournaments', { name: 'Next Monday', templateId: saved.body.id, buyIn: 15000, tableCount: 2, seatsPerTable: 3 });
    expect(t.status).toBe(201);
    expect(t.body.payouts).toEqual([60, 40]);
    expect(t.body.levels).toEqual((await storage.getTournament(tid))!.levels);
    const copy = await post('/api/tournaments', { name: 'Copy', fromTournamentId: tid, tableCount: 1, seatsPerTable: 9 });
    expect(copy.body).toMatchObject({ payouts: [60, 40], levels: t.body.levels });
    const list = (await app.inject({ url: '/api/templates', headers: { cookie } })).json();
    expect(list).toHaveLength(1);
    await app.inject({ method: 'DELETE', url: `/api/templates/${saved.body.id}`, headers: { cookie } });
    expect((await app.inject({ url: '/api/templates', headers: { cookie } })).json()).toHaveLength(0);
  });
});
