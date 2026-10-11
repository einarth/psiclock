import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { SqliteStorage } from './storage/sqlite';
import { signedIn } from './testing';
import { defaultStructures } from '../shared/structures';

describe('logins and roles', () => {
  let app: FastifyInstance;
  let storage: SqliteStorage;

  type Opts = { cookie?: string; payload?: object; remoteAddress?: string };
  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, o: Opts = {}) => {
    const res = await app.inject({
      method,
      url,
      payload: method === 'GET' ? undefined : (o.payload ?? {}),
      headers: o.cookie ? { cookie: o.cookie } : {},
      remoteAddress: o.remoteAddress,
    });
    const setCookie = String(res.headers['set-cookie'] ?? '').split(';')[0];
    return { status: res.statusCode, body: res.json(), cookie: setCookie };
  };

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.init();
    await storage.createStructure(defaultStructures[0]);
    app = await buildApp({ storage });
  });
  afterEach(async () => {
    await app.close();
    await storage.close();
  });

  it('creates the first admin only from the laptop itself, and only once', async () => {
    expect((await call('GET', '/api/auth/me')).body).toMatchObject({ user: null, setupNeeded: true });
    const away = await call('POST', '/api/auth/setup', {
      payload: { username: 'einar', password: 'longenough' },
      remoteAddress: '192.168.1.40',
    });
    expect(away.status).toBe(403);
    const here = await call('POST', '/api/auth/setup', { payload: { username: 'einar', password: 'longenough' } });
    expect(here.status).toBe(201);
    expect(here.body.user.role).toBe('admin');
    expect((await call('GET', '/api/auth/me', { cookie: here.cookie })).body.user.username).toBe('einar');
    expect((await call('POST', '/api/auth/setup', { payload: { username: 'x2', password: 'longenough' } })).status).toBe(409);
  });

  it('lets guests watch but not change anything', async () => {
    const admin = await signedIn(storage);
    const t = await call('POST', '/api/tournaments', { cookie: admin, payload: { name: 'T', structureId: 1 } });
    expect((await call('GET', '/api/tournaments')).status).toBe(200);
    expect((await call('GET', `/api/tournaments/${t.body.id}/entries`)).status).toBe(200);
    expect((await call('POST', `/api/tournaments/${t.body.id}/clock`, { payload: { type: 'clock.start' } })).status).toBe(401);
    expect((await call('GET', '/api/players')).status).toBe(401);
    expect((await call('GET', `/api/tournaments/${t.body.id}/results.csv`)).status).toBe(401);
  });

  it('gives each role its own powers', async () => {
    const admin = await signedIn(storage);
    const floor = await signedIn(storage, 'floor');
    const desk = await signedIn(storage, 'desk');
    const t = (await call('POST', '/api/tournaments', { cookie: admin, payload: { name: 'T', structureId: 1, tableCount: 1 } })).body;
    const p = await call('POST', '/api/players', { cookie: floor, payload: { name: 'A' } });
    expect(p.status).toBe(403);
    const player = (await call('POST', '/api/players', { cookie: desk, payload: { name: 'A' } })).body;
    await call('POST', '/api/players', { cookie: desk, payload: { name: 'B' } });
    const entry = await call('POST', `/api/tournaments/${t.id}/entries`, { cookie: desk, payload: { playerId: player.id } });
    expect(entry.status).toBe(201);
    await call('POST', `/api/tournaments/${t.id}/entries`, { cookie: desk, payload: { playerId: player.id + 1 } });
    expect((await call('POST', `/api/tournaments/${t.id}/entries/${entry.body.id}/bust`, { cookie: floor })).status).toBe(200);
    expect((await call('POST', `/api/tournaments/${t.id}/clock`, { cookie: desk, payload: { type: 'clock.start' } })).status).toBe(403);
    expect((await call('GET', '/api/users', { cookie: admin.replace(/=.*/, '=nonsense') })).status).toBe(401);
    expect((await call('GET', '/api/users', { cookie: desk })).status).toBe(403);
    // The action log names who did it.
    const actions = (await call('GET', `/api/tournaments/${t.id}/actions`, { cookie: admin })).body;
    expect(actions.find((a: { type: string }) => a.type === 'entry.bust').actor).toBe('floor');
  });

  it('signs in with a password and slows down guessing', async () => {
    const admin = await signedIn(storage);
    await call('POST', '/api/users', { cookie: admin, payload: { username: 'Sigga', role: 'desk', password: 'deskdesk1' } });
    expect((await call('POST', '/api/auth/login', { payload: { username: 'sigga', password: 'nope' } })).status).toBe(401);
    const ok = await call('POST', '/api/auth/login', { payload: { username: 'sigga', password: 'deskdesk1' } });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('desk');
    for (let i = 0; i < 10; i++) {
      await call('POST', '/api/auth/login', { payload: { username: 'sigga', password: 'wrong' }, remoteAddress: '10.0.0.9' });
    }
    const blocked = await call('POST', '/api/auth/login', {
      payload: { username: 'sigga', password: 'deskdesk1' },
      remoteAddress: '10.0.0.9',
    });
    expect(blocked.status).toBe(429);
  });

  it('manages users and always keeps one admin', async () => {
    const admin = await signedIn(storage, 'admin', 'boss');
    const me = (await call('GET', '/api/auth/me', { cookie: admin })).body.user;
    expect((await call('PATCH', `/api/users/${me.id}`, { cookie: admin, payload: { role: 'desk' } })).status).toBe(400);
    const u = await call('POST', '/api/users', { cookie: admin, payload: { username: 'floor1', role: 'floor', password: 'short' } });
    expect(u.status).toBe(400);
    const made = await call('POST', '/api/users', { cookie: admin, payload: { username: 'floor1', role: 'floor', password: 'floorfloor' } });
    expect(made.status).toBe(201);
    expect((await call('POST', '/api/users', { cookie: admin, payload: { username: 'FLOOR1', role: 'floor', password: 'floorfloor' } })).status).toBe(409);
    const login = await call('POST', '/api/auth/login', { payload: { username: 'floor1', password: 'floorfloor' } });
    await call('PATCH', `/api/users/${made.body.id}`, { cookie: admin, payload: { active: false } });
    expect((await call('GET', '/api/auth/me', { cookie: login.cookie })).body.user).toBeNull();
    expect((await call('POST', '/api/auth/login', { payload: { username: 'floor1', password: 'floorfloor' } })).status).toBe(401);
  });

  it('changes your own password and signs out other sessions', async () => {
    const admin = await signedIn(storage, 'admin', 'boss');
    const other = (await call('POST', '/api/auth/login', { payload: { username: 'boss', password: 'password123' } })).cookie;
    expect((await call('POST', '/api/auth/password', { cookie: admin, payload: { current: 'bad', password: 'newpassword' } })).status).toBe(400);
    const changed = await call('POST', '/api/auth/password', {
      cookie: admin,
      payload: { current: 'password123', password: 'newpassword' },
    });
    expect(changed.status).toBe(200);
    expect((await call('GET', '/api/auth/me', { cookie: other })).body.user).toBeNull();
    expect((await call('GET', '/api/auth/me', { cookie: changed.cookie })).body.user.username).toBe('boss');
  });
});
