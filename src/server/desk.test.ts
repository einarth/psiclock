import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { SqliteStorage } from './storage/sqlite';
import { signedIn } from './testing';
import { defaultStructures } from '../shared/structures';
import { defaultMoney, normalizeMoney } from '../shared/money';
import type { Entry } from '../shared/types';

describe('desk and money', () => {
  let app: FastifyInstance;
  let storage: SqliteStorage;
  let tid: number;
  let cookie: string;
  const money = { ...defaultMoney, allowRebuys: true, allowAddOn: true, rebuyPrice: 10000, rebuyChips: 20000, rebuyUntilLevel: 4, addOnPrice: 10000, addOnChips: 30000, lateRegUntilLevel: 4 };

  const call = async (method: 'POST' | 'PATCH', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload: payload ?? {}, headers: { cookie } });
    return { status: res.statusCode, body: res.json() };
  };
  const post = (url: string, payload?: object) => call('POST', url, payload);
  const entries = async () => (await app.inject({ url: `/api/tournaments/${tid}/entries` })).json() as Entry[];
  const register = async (name: string, force = false) => {
    const p = await post('/api/players', { name });
    return post(`/api/tournaments/${tid}/entries`, { playerId: p.body.id, force });
  };

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.init();
    const s = await storage.createStructure(defaultStructures[0]);
    app = await buildApp({ storage });
    cookie = await signedIn(storage);
    const t = await post('/api/tournaments', {
      name: 'Main',
      structureId: s.id,
      buyIn: 20000,
      fee: 2000,
      startingStack: 30000,
      tableCount: 2,
      seatsPerTable: 9,
      money,
    });
    tid = t.body.id;
    for (const name of ['A', 'B', 'C', 'D']) await register(name);
  });
  afterEach(async () => {
    await app.close();
    await storage.close();
  });

  it('rebuys a busted player back into their seat and can undo it', async () => {
    const [a] = await entries();
    await post(`/api/tournaments/${tid}/entries/${a.id}/bust`);
    const r = await post(`/api/tournaments/${tid}/entries/${a.id}/rebuy`);
    expect(r.body).toMatchObject({ rebuys: 1, table: a.table, seat: a.seat });
    expect((await entries())[0]).toMatchObject({ bustSeq: null, rebuys: 1 });
    await post(`/api/tournaments/${tid}/entries/${a.id}/rebuy/undo`);
    expect((await entries())[0].rebuys).toBe(0);
  });

  it('only allows rebuys and add-ons when they are switched on', async () => {
    await call('PATCH', `/api/tournaments/${tid}`, { money: { allowRebuys: false, allowAddOn: false } });
    const [a, b] = await entries();
    await post(`/api/tournaments/${tid}/entries/${a.id}/bust`);
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/rebuy`)).body.error).toMatch(/no rebuys/);
    expect((await post(`/api/tournaments/${tid}/entries/${b.id}/add-on`)).body.error).toMatch(/no add-on/);
    expect((await call('PATCH', `/api/tournaments/${tid}`, { money: { allowRebuys: 1 } })).status).toBe(400);
  });

  it('treats a rebuy price saved before the switch existed as rebuys on', () => {
    expect(normalizeMoney({ rebuyPrice: 5000 }).allowRebuys).toBe(true);
    expect(normalizeMoney({ rebuyPrice: 5000 }).allowAddOn).toBe(false);
    expect(normalizeMoney({ rebuyPrice: 5000, allowRebuys: false }).allowRebuys).toBe(false);
  });

  it('edits the blind structure and keeps the clock on the level being played', async () => {
    const put = (payload: object) => app.inject({ method: 'PUT', url: `/api/tournaments/${tid}/levels`, payload, headers: { cookie } });
    await post(`/api/tournaments/${tid}/clock`, { type: 'clock.start' });
    await post(`/api/tournaments/${tid}/clock`, { type: 'clock.setLevel', levelIndex: 2 });
    const old = (await storage.getTournament(tid))!.levels;
    // Drop the first level and add one in front of the current level: it moves from 2 to 2.
    const extra = { kind: 'level', smallBlind: 150, bigBlind: 300, ante: 300, minutes: 20 };
    const levels = [old[1], extra, ...old.slice(2)];
    expect((await put({ levels, currentIndex: 2, expectedIndex: 2 })).statusCode).toBe(200);
    let t = (await storage.getTournament(tid))!;
    expect(t.levels[1]).toEqual(extra);
    expect(t.clock.levelIndex).toBe(2);
    expect(t.clock.running).toBe(true);
    // The clock moved on since the editor opened.
    expect((await put({ levels, currentIndex: 2, expectedIndex: 0 })).statusCode).toBe(409);
    // Bad levels are refused.
    const bad = [{ kind: 'level', smallBlind: 400, bigBlind: 200, ante: 0, minutes: 20 }];
    expect((await put({ levels: bad, currentIndex: 0, expectedIndex: 2 })).statusCode).toBe(400);
    expect((await put({ levels: [], currentIndex: 0, expectedIndex: 2 })).statusCode).toBe(400);
    t = (await storage.getTournament(tid))!;
    expect(t.levels).toEqual(levels);
  });

  it('gives each player one add-on at most', async () => {
    const [a] = await entries();
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/add-on`)).status).toBe(200);
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/add-on`)).status).toBe(400);
    await post(`/api/tournaments/${tid}/entries/${a.id}/add-on`, { undo: true });
    expect((await entries())[0].addOn).toBe(false);
  });

  it('closes registration and rebuys after their level unless forced', async () => {
    await post(`/api/tournaments/${tid}/clock`, { type: 'clock.setLevel', levelIndex: 6 });
    const late = await register('Late');
    expect(late.status).toBe(409);
    expect((await register('Late2', true)).status).toBe(201);
    const [a] = await entries();
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/rebuy`)).status).toBe(409);
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/rebuy`, { force: true })).status).toBe(200);
  });

  it('saves hand-edited payouts and rejects ones that do not add up', async () => {
    expect((await call('PATCH', `/api/tournaments/${tid}`, { payouts: [70, 20] })).status).toBe(400);
    expect((await call('PATCH', `/api/tournaments/${tid}`, { payouts: [65, 35] })).status).toBe(200);
    expect((await storage.getTournament(tid))!.payouts).toEqual([65, 35]);
    expect((await call('PATCH', `/api/tournaments/${tid}`, { money: { ...money, rounding: -1 } })).status).toBe(400);
    expect((await call('PATCH', `/api/tournaments/${tid}`, { money: { bogus: 1 } })).status).toBe(400);
  });

  it('sets the start time and a hand-set prize pool, and clears them again', async () => {
    const patch = (body: object) => call('PATCH', `/api/tournaments/${tid}`, body);
    expect((await patch({ startsAt: 'tomorrow-ish' })).status).toBe(400);
    expect((await patch({ startsAt: '2026-10-18T19:00:00.000Z', prizePoolOverride: 1_000_000 })).status).toBe(200);
    let t = (await storage.getTournament(tid))!;
    expect(t.startsAt).toBe('2026-10-18T19:00:00.000Z');
    expect(t.prizePoolOverride).toBe(1_000_000);
    expect((await patch({ prizePoolOverride: -5 })).status).toBe(400);
    expect((await patch({ prizePoolOverride: 1.5 })).status).toBe(400);
    await patch({ startsAt: null, prizePoolOverride: null });
    t = (await storage.getTournament(tid))!;
    expect([t.startsAt, t.prizePoolOverride]).toEqual([null, null]);
  });

  it('merges partly given money settings with the rest', async () => {
    expect((await call('PATCH', `/api/tournaments/${tid}`, { money: { guarantee: 500000 } })).status).toBe(200);
    expect((await storage.getTournament(tid))!.money).toEqual({ ...money, guarantee: 500000 });
    await call('PATCH', `/api/tournaments/${tid}`, { money });
  });

  it('pays players in the money and exports results', async () => {
    await call('PATCH', `/api/tournaments/${tid}`, { payouts: [70, 30] });
    const [a, b, c] = await entries();
    await post(`/api/tournaments/${tid}/entries/${a.id}/bust`); // 4th, no prize
    await post(`/api/tournaments/${tid}/entries/${b.id}/bust`); // 3rd, no prize
    await post(`/api/tournaments/${tid}/entries/${c.id}/bust`); // 2nd
    expect((await post(`/api/tournaments/${tid}/entries/${a.id}/paid`)).status).toBe(400);
    const paid = await post(`/api/tournaments/${tid}/entries/${c.id}/paid`);
    expect(paid.body.paidOut).toBe(24000); // 30% of 4 x 20000
    const csv = (await app.inject({ url: `/api/tournaments/${tid}/results.csv`, headers: { cookie } })).body;
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines[0]).toBe('Place,Name,Full name,Email,Phone,Rebuys,Add-on,Prize,Paid');
    expect(lines[1]).toBe('1,D,,,,0,,56000,');
    expect(lines[2]).toBe('2,C,,,,0,,24000,24000');
  });
});
