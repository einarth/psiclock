import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { Storage } from './storage/storage.js';
import { Hub } from './hub.js';
import { applyClockCommand, clockAt, initialClock } from '../shared/clock.js';
import type { ClockCommand, Level, NewPlayer } from '../shared/types.js';

export interface AppOptions {
  storage: Storage;
  /** Folder with the built web app; omitted in dev, where Vite serves it. */
  webRoot?: string;
  logger?: boolean;
}

const clockCommands = new Set(['clock.start', 'clock.pause', 'clock.adjust', 'clock.setLevel']);

function validLevels(levels: unknown): levels is Level[] {
  return (
    Array.isArray(levels) &&
    levels.length > 0 &&
    levels.every(
      (l) =>
        l &&
        typeof l.minutes === 'number' &&
        l.minutes > 0 &&
        (l.kind === 'break' ||
          (l.kind === 'level' && [l.smallBlind, l.bigBlind, l.ante].every((n) => typeof n === 'number' && n >= 0))),
    )
  );
}

export async function buildApp({ storage, webRoot, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  const hub = new Hub();
  await app.register(websocket);

  app.get('/api/time', async () => ({ serverTime: Date.now() }));

  // Players
  app.get<{ Querystring: { search?: string } }>('/api/players', async (req) => storage.listPlayers(req.query.search));

  app.post<{ Body: NewPlayer }>('/api/players', async (req, reply) => {
    if (!req.body?.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    const player = await storage.createPlayer(req.body);
    await storage.appendAction({ tournamentId: null, type: 'player.create', payload: player, actor: 'desk' });
    return reply.code(201).send(player);
  });

  app.patch<{ Params: { id: string }; Body: Partial<NewPlayer> }>('/api/players/:id', async (req, reply) => {
    if (req.body?.name !== undefined && !req.body.name.trim()) {
      return reply.code(400).send({ error: 'name cannot be blank' });
    }
    const player = await storage.updatePlayer(Number(req.params.id), req.body ?? {});
    if (!player) return reply.code(404).send({ error: 'player not found' });
    await storage.appendAction({ tournamentId: null, type: 'player.update', payload: player, actor: 'desk' });
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
    Body: { name?: string; buyIn?: number; fee?: number; startingStack?: number; structureId?: number; theme?: string };
  }>('/api/tournaments', async (req, reply) => {
    const b = req.body ?? {};
    if (!b.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    const structure = (await storage.listStructures()).find((s) => s.id === b.structureId);
    if (!structure) return reply.code(400).send({ error: 'unknown blind structure' });
    const t = await storage.createTournament(
      {
        name: b.name.trim(),
        buyIn: Number(b.buyIn ?? 0),
        fee: Number(b.fee ?? 0),
        startingStack: Number(b.startingStack ?? 0),
        levels: structure.levels,
        theme: b.theme,
      },
      initialClock(Date.now()),
    );
    await storage.appendAction({ tournamentId: t.id, type: 'tournament.create', payload: t, actor: 'director' });
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
    await storage.appendAction({ tournamentId: id, type: cmd.type, payload: cmd, actor: 'director' });
    const updated = { ...t, clock, status };
    hub.publishTournament(updated);
    return updated;
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id/actions', async (req) =>
    storage.listActions(Number(req.params.id)),
  );

  // Live updates: a client opens /ws?tournament=<id> and gets the tournament now and on every change.
  app.get<{ Querystring: { tournament?: string } }>('/ws', { websocket: true }, async (socket, req) => {
    hub.send(socket, { type: 'hello', serverTime: Date.now() });
    const id = Number(req.query.tournament);
    if (!id) return;
    hub.watch(id, socket);
    const t = await storage.getTournament(id);
    if (t) hub.send(socket, { type: 'tournament', tournament: t, serverTime: Date.now() });
  });

  if (webRoot && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    // Client-side routes such as /display/3 all load the same page.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}
