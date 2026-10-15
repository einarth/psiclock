import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { Storage } from './storage/storage.js';
import { Hub } from './hub.js';
import { registerFloorRoutes } from './floor.js';
import { registerDeskRoutes, startTime, validLevels, validMoney } from './desk.js';
import { createActionRunner } from './actions.js';
import { actorOf, registerAuth } from './auth.js';
import { MOVE_TYPES, layoutFor, movesFrom, registerScreenRoutes } from './screens.js';
import { registerTemplateRoutes, templateFrom } from './templates.js';
import { applyClockCommand, clockAt, initialClock } from '../shared/clock.js';
import type { ClockCommand, Id, Level, MoneyConfig, NewPlayer, ServerMessage, TableConfig } from '../shared/types.js';
import type { Rand } from '../shared/seating.js';

export interface AppOptions {
  storage: Storage;
  /** Folder with the built web app; omitted in dev, where Vite serves it. */
  webRoot?: string;
  /** Or the web app's files embedded in the packaged .exe, looked up by path such as 'index.html'. */
  webFiles?: (path: string) => Buffer | null;
  logger?: boolean;
  /** Random source for seat draws; tests pass a fixed one. */
  rand?: Rand;
}

const clockCommands = new Set(['clock.start', 'clock.pause', 'clock.adjust', 'clock.setLevel']);

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

export async function buildApp({ storage, webRoot, webFiles, logger = false, rand }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  const hub = new Hub();
  await app.register(websocket);
  registerAuth(app, storage);

  /** Everything a screen needs about one tournament, as pushed over the WebSocket. */
  const snapshot = async (id: Id): Promise<ServerMessage | null> => {
    const t = await storage.getTournament(id);
    if (!t) return null;
    const entries = await storage.listEntries(id);
    const actions = await storage.listActions(id, { types: MOVE_TYPES, limit: 60 });
    return {
      type: 'tournament',
      tournament: t,
      entries,
      layout: await layoutFor(storage, t.layoutId),
      moves: movesFrom(actions, entries),
      serverTime: Date.now(),
    };
  };
  const publish = async (id: Id) => {
    const msg = await snapshot(id);
    if (msg) hub.publish(id, msg);
  };
  const publishAll = async () => {
    for (const id of hub.watched()) await publish(id);
  };
  const run = createActionRunner(storage, publish);
  registerFloorRoutes(app, storage, run, rand);
  registerDeskRoutes(app, storage, run, rand);
  registerTemplateRoutes(app, storage);
  registerScreenRoutes(app, storage, run, publishAll);

  app.get('/api/time', async () => ({ serverTime: Date.now() }));

  // Players
  app.get<{ Querystring: { search?: string } }>('/api/players', async (req) => storage.listPlayers(req.query.search));

  app.get<{ Params: { id: string } }>('/api/players/:id', async (req, reply) => {
    const player = await storage.getPlayer(Number(req.params.id));
    return player ?? reply.code(404).send({ error: 'player not found' });
  });

  app.post<{ Body: NewPlayer }>('/api/players', async (req, reply) => {
    if (!req.body?.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    const player = await storage.createPlayer(req.body);
    await storage.appendAction({ tournamentId: null, type: 'player.create', payload: player, actor: actorOf(req, 'desk') });
    return reply.code(201).send(player);
  });

  app.patch<{ Params: { id: string }; Body: Partial<NewPlayer> }>('/api/players/:id', async (req, reply) => {
    if (req.body?.name !== undefined && !req.body.name.trim()) {
      return reply.code(400).send({ error: 'name cannot be blank' });
    }
    const player = await storage.updatePlayer(Number(req.params.id), req.body ?? {});
    if (!player) return reply.code(404).send({ error: 'player not found' });
    await storage.appendAction({ tournamentId: null, type: 'player.update', payload: player, actor: actorOf(req, 'desk') });
    // A new name shows on the screens straight away.
    if (req.body?.name !== undefined) await publishAll();
    return player;
  });

  // Blind structures
  app.get('/api/structures', async () => storage.listStructures());

  app.post<{ Body: { name?: string; levels?: unknown } }>('/api/structures', async (req, reply) => {
    const { name, levels } = req.body ?? {};
    if (!name?.trim() || !validLevels(levels)) return reply.code(400).send({ error: 'name and valid levels required' });
    return reply.code(201).send(await storage.createStructure({ name: name.trim(), levels }));
  });

  // Tournaments
  app.get('/api/tournaments', async () => storage.listTournaments());

  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const t = await storage.getTournament(Number(req.params.id));
    return t ?? reply.code(404).send({ error: 'tournament not found' });
  });

  app.post<{
    Body: {
      name?: string;
      buyIn?: number;
      fee?: number;
      startingStack?: number;
      structureId?: number;
      /** Start from a saved template: its levels, money settings, payout table and layout. */
      templateId?: number;
      /** Or start from an earlier tournament the same way. */
      fromTournamentId?: number;
      theme?: string;
      tableCount?: number;
      seatsPerTable?: number;
      money?: MoneyConfig;
      /** When play is planned to start, as an ISO time. */
      startsAt?: string | null;
    };
  }>('/api/tournaments', async (req, reply) => {
    const b = req.body ?? {};
    if (!b.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    const source = b.fromTournamentId ? await storage.getTournament(Number(b.fromTournamentId)) : null;
    if (b.fromTournamentId && !source) return reply.code(400).send({ error: 'tournament to copy not found' });
    const template = source ? templateFrom(source) : b.templateId ? await storage.getTemplate(Number(b.templateId)) : null;
    if (b.templateId && !template) return reply.code(400).send({ error: 'template not found' });
    const structure = template ? null : (await storage.listStructures()).find((s) => s.id === b.structureId);
    if (!template && !structure) return reply.code(400).send({ error: 'unknown blind structure' });
    // A template's layout may have been deleted since it was saved.
    const layoutId = template?.layoutId && (await storage.getLayout(template.layoutId)) ? template.layoutId : null;
    if (b.money !== undefined && !validMoney(b.money)) {
      return reply.code(400).send({ error: 'money settings must all be whole numbers of 0 or more' });
    }
    const startsAt = startTime(b.startsAt);
    if (startsAt === undefined) return reply.code(400).send({ error: 'the start time is not a valid date and time' });
    const tableCount = Number(b.tableCount ?? 0);
    const seatsPerTable = Number(b.seatsPerTable ?? 9);
    if (!(tableCount >= 0 && tableCount <= 50 && seatsPerTable >= 2 && seatsPerTable <= 12)) {
      return reply.code(400).send({ error: 'use 0 to 50 tables of 2 to 12 seats' });
    }
    const tables: TableConfig[] = Array.from({ length: tableCount }, (_, i) => ({
      number: i + 1,
      seats: seatsPerTable,
      open: true,
    }));
    const t = await storage.createTournament(
      {
        name: b.name.trim(),
        buyIn: Number(b.buyIn ?? 0),
        fee: Number(b.fee ?? 0),
        startingStack: Number(b.startingStack ?? 0),
        levels: template?.levels ?? structure!.levels,
        theme: b.theme,
        tables,
        money: b.money ?? template?.money,
        payouts: template?.payouts ?? null,
        layoutId,
        startsAt,
      },
      initialClock(Date.now()),
    );
    await storage.appendAction({ tournamentId: t.id, type: 'tournament.create', payload: t, actor: actorOf(req, 'director') });
    return reply.code(201).send(t);
  });

  app.post<{ Params: { id: string }; Body: ClockCommand }>('/api/tournaments/:id/clock', async (req, reply) => {
    const id = Number(req.params.id);
    const cmd = req.body;
    if (!cmd || !clockCommands.has(cmd.type)) return reply.code(400).send({ error: 'unknown clock command' });
    const t = await storage.getTournament(id);
    if (!t) return reply.code(404).send({ error: 'tournament not found' });
    const now = Date.now();
    const clock = applyClockCommand(t.levels, t.clock, cmd, now);
    const finished = clockAt(t.levels, clock, now).finished;
    const status = t.status === 'setup' && cmd.type === 'clock.start' ? 'running' : finished ? 'finished' : t.status;
    await storage.updateTournamentClock(id, clock, status);
    await storage.appendAction({ tournamentId: id, type: cmd.type, payload: cmd, actor: actorOf(req, 'director') });
    await publish(id);
    return { ...t, clock, status };
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id/entries', async (req) =>
    storage.listEntries(Number(req.params.id)),
  );

  app.get<{ Params: { id: string } }>('/api/tournaments/:id/actions', async (req) =>
    storage.listActions(Number(req.params.id)),
  );

  // Live updates: a client opens /ws?tournament=<id> and gets the tournament now and on every change.
  app.get<{ Querystring: { tournament?: string } }>('/ws', { websocket: true }, async (socket, req) => {
    hub.send(socket, { type: 'hello', serverTime: Date.now() });
    const id = Number(req.query.tournament);
    if (!id) return;
    hub.watch(id, socket);
    const msg = await snapshot(id);
    if (msg) hub.send(socket, msg);
  });

  if (webRoot && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    // Client-side routes such as /display/3 all load the same page.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'),
    );
  } else if (webFiles) {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path ? webFiles(path) : null;
      if (file) {
        // Built files have a content hash in their name, so they never change.
        const cache = path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
        return reply.type(contentTypes[extname(path)] ?? 'application/octet-stream').header('cache-control', cache).send(file);
      }
      // Client-side routes such as /display/3 all load the same page.
      return reply.type(contentTypes['.html']).header('cache-control', 'no-cache').send(webFiles('index.html'));
    });
  }

  return app;
}
