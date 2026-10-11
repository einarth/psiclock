import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { SqliteStorage } from './storage/sqlite';
import { signedIn } from './testing';
import { defaultStructures } from '../shared/structures';
import { defaultLayout } from '../shared/layout';
import type { Entry } from '../shared/types';

describe('layouts and screens', () => {
  let app: FastifyInstance;
  let storage: SqliteStorage;
  let cookie: string;
  let tid: number;

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : (payload ?? {}), headers: { cookie } });
    return { status: res.statusCode, body: res.json() };
  };

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.init();
    const s = await storage.createStructure(defaultStructures[0]);
    app = await buildApp({ storage, rand: () => 0.5 });
    cookie = await signedIn(storage, 'director');
    tid = (await call('POST', '/api/tournaments', { name: 'T', structureId: s.id, tableCount: 2, seatsPerTable: 4 })).body.id;
  });
  afterEach(async () => {
    await app.close();
    await storage.close();
  });

  it('saves a layout, rejects broken ones and assigns it to a tournament', async () => {
    const bad = await call('POST', '/api/layouts', { name: 'X', layout: { ...defaultLayout, colors: { bg: 'red; x' } } });
    expect(bad.status).toBe(400);
    const layout = {
      ...defaultLayout,
      zones: { ...defaultLayout.zones, left: [{ type: 'message', text: 'Welcome', extra: 'dropped' }] },
    };
    const made = await call('POST', '/api/layouts', { name: 'Sponsor night', layout });
    expect(made.status).toBe(201);
    expect(made.body.zones.left).toEqual([{ type: 'message', text: 'Welcome' }]);
    expect((await call('PATCH', `/api/tournaments/${tid}`, { layoutId: made.body.id })).status).toBe(200);
    expect((await storage.getTournament(tid))!.layoutId).toBe(made.body.id);
    await call('DELETE', `/api/layouts/${made.body.id}`);
    expect((await storage.getTournament(tid))!.layoutId).toBeNull();
  });

  it('stores uploaded images and serves them to anyone', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const up = await app.inject({
      method: 'POST',
      url: '/api/assets?name=logo.png',
      payload: png,
      headers: { cookie, 'content-type': 'image/png' },
    });
    expect(up.statusCode).toBe(201);
    const got = await app.inject({ url: `/api/assets/${up.json().id}` });
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.rawPayload.equals(png)).toBe(true);
    const text = await app.inject({ method: 'POST', url: '/api/assets', payload: 'hi', headers: { cookie, 'content-type': 'text/plain' } });
    expect(text.statusCode).toBe(400);
  });

  it('switches the big screen and shows moves after a table breaks', async () => {
    const shown = await call('POST', `/api/tournaments/${tid}/screen`, { scene: 'seating', seconds: 30 });
    expect(shown.body.scene).toBe('seating');
    expect(shown.body.until).toBeGreaterThan(Date.now());
    expect((await call('POST', `/api/tournaments/${tid}/screen`, { scene: 'disco' })).status).toBe(400);
    for (const name of ['A', 'B', 'C']) {
      const p = (await call('POST', '/api/players', { name })).body;
      await call('POST', `/api/tournaments/${tid}/entries`, { playerId: p.id });
    }
    const entries = (await call('GET', `/api/tournaments/${tid}/entries`)).body as Entry[];
    const table = entries.filter((e) => e.table === 1).length <= 1 ? 1 : 2;
    expect((await call('POST', `/api/tournaments/${tid}/tables/${table}/break`)).status).toBe(200);
    const t = await storage.getTournament(tid);
    expect(t!.screen.scene).toBe('moves');
    const { movesFrom } = await import('./screens');
    const moves = movesFrom(await storage.listActions(tid, { types: ['table.break'], limit: 5 }), entries);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0]).toMatchObject({ reason: 'break', from: { table } });
  });
});
