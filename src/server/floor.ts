import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Storage } from './storage/storage.js';
import type { Entry, Id, Tournament } from '../shared/types.js';
import {
  breakTableMoves,
  finishingPlace,
  freeSeats,
  isAlive,
  redrawSeats,
  seatForNewPlayer,
  type Rand,
} from '../shared/seating.js';

/** Thrown inside a floor action to answer the request with a 4xx and a readable message. */
class FloorError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Ctx {
  t: Tournament;
  entries: Entry[];
  entry(id: string | number): Entry;
}

/**
 * Registration, seating, bustouts and table moves. Each action runs under a
 * per-tournament lock and in a transaction, is written to the action log and
 * is pushed to every screen watching the tournament.
 */
export function registerFloorRoutes(
  app: FastifyInstance,
  storage: Storage,
  publish: (id: Id) => Promise<void>,
  rand: Rand = Math.random,
) {
  const locks = new Map<Id, Promise<unknown>>();

  async function run<T>(
    reply: FastifyReply,
    tournamentId: Id,
    type: string,
    actor: string,
    fn: (ctx: Ctx) => Promise<{ result: T; payload: unknown }>,
  ) {
    const previous = locks.get(tournamentId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() =>
      storage.transaction(async () => {
        const t = await storage.getTournament(tournamentId);
        if (!t) throw new FloorError('tournament not found', 404);
        const entries = await storage.listEntries(tournamentId);
        const entry = (id: string | number) => {
          const e = entries.find((x) => x.id === Number(id));
          if (!e) throw new FloorError('entry not found', 404);
          return e;
        };
        const { result, payload } = await fn({ t, entries, entry });
        await storage.appendAction({ tournamentId, type, payload, actor });
        return result;
      }),
    );
    locks.set(tournamentId, task);
    try {
      const result = await task;
      await publish(tournamentId);
      return result;
    } catch (err) {
      if (err instanceof FloorError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  }

  type P = { id: string };
  type PE = { id: string; entryId: string };
  type PT = { id: string; table: string };

  app.post<{ Params: P; Body: { playerId?: number } }>('/api/tournaments/:id/entries', (req, reply) =>
    run(reply.code(201), Number(req.params.id), 'entry.create', 'desk', async ({ t, entries }) => {
      const player = await storage.getPlayer(Number(req.body?.playerId));
      if (!player) throw new FloorError('player not found', 404);
      if (t.status === 'finished') throw new FloorError('the tournament has finished');
      const seat = seatForNewPlayer(t.tables, entries, rand);
      if (!seat) throw new FloorError('every seat is taken; add a table first');
      const entry = await storage.createEntry(t.id, player.id, seat);
      return { result: entry, payload: { entryId: entry.id, playerId: player.id, ...seat } };
    }),
  );

  app.post<{ Params: PE }>('/api/tournaments/:id/entries/:entryId/bust', (req, reply) =>
    run(reply, Number(req.params.id), 'entry.bust', 'floor', async ({ entries, entry }) => {
      const e = entry(req.params.entryId);
      if (!isAlive(e)) throw new FloorError(`${e.playerName} is already out`);
      if (entries.filter(isAlive).length === 1) throw new FloorError(`${e.playerName} is the last player left`);
      const bustSeq = Math.max(0, ...entries.map((x) => x.bustSeq ?? 0)) + 1;
      // The seat is kept on the record so an undo can put the player back where they sat.
      await storage.updateEntry(e.id, { table: e.table, seat: e.seat, bustSeq });
      const after = entries.map((x) => (x.id === e.id ? { ...x, bustSeq } : x));
      const place = finishingPlace(after, { ...e, bustSeq });
      return { result: { place }, payload: { entryId: e.id, table: e.table, seat: e.seat, place } };
    }),
  );

  app.post<{ Params: PE }>('/api/tournaments/:id/entries/:entryId/restore', (req, reply) =>
    run(reply, Number(req.params.id), 'entry.restore', 'floor', async ({ t, entries, entry }) => {
      const e = entry(req.params.entryId);
      if (isAlive(e)) throw new FloorError(`${e.playerName} is not out`);
      const table = t.tables.find((x) => x.number === e.table);
      const sameSeatFree = table?.open && e.seat !== null && freeSeats(table, entries).includes(e.seat);
      const seat = sameSeatFree ? { table: e.table!, seat: e.seat! } : seatForNewPlayer(t.tables, entries, rand);
      if (!seat) throw new FloorError('no free seat to put the player back in');
      await storage.updateEntry(e.id, { ...seat, bustSeq: null });
      return { result: seat, payload: { entryId: e.id, ...seat } };
    }),
  );

  app.post<{ Params: PE; Body: { table?: number; seat?: number } }>(
    '/api/tournaments/:id/entries/:entryId/move',
    (req, reply) =>
      run(reply, Number(req.params.id), 'entry.move', 'floor', async ({ t, entries, entry }) => {
        const e = entry(req.params.entryId);
        if (!isAlive(e)) throw new FloorError(`${e.playerName} is out`);
        const table = t.tables.find((x) => x.number === Number(req.body?.table) && x.open);
        if (!table) throw new FloorError('pick an open table');
        const free = freeSeats(table, entries);
        const seat = req.body?.seat ?? free[Math.floor(rand() * free.length)];
        if (seat === undefined || !free.includes(seat)) throw new FloorError(`no free seat ${seat ?? ''} at table ${table.number}`);
        await storage.updateEntry(e.id, { table: table.number, seat, bustSeq: null });
        const to = { table: table.number, seat };
        return { result: to, payload: { entryId: e.id, from: { table: e.table, seat: e.seat }, to } };
      }),
  );

  app.post<{ Params: P; Body: { seats?: number } }>('/api/tournaments/:id/tables', (req, reply) =>
    run(reply, Number(req.params.id), 'table.add', 'floor', async ({ t }) => {
      const seats = Number(req.body?.seats ?? t.tables.at(-1)?.seats ?? 9);
      if (!(seats >= 2 && seats <= 12)) throw new FloorError('a table needs 2 to 12 seats');
      const number = Math.max(0, ...t.tables.map((x) => x.number)) + 1;
      await storage.updateTournament(t.id, { tables: [...t.tables, { number, seats, open: true }] });
      return { result: { number, seats }, payload: { number, seats } };
    }),
  );

  app.post<{ Params: PT }>('/api/tournaments/:id/tables/:table/break', (req, reply) =>
    run(reply, Number(req.params.id), 'table.break', 'floor', async ({ t, entries }) => {
      const no = Number(req.params.table);
      if (!t.tables.some((x) => x.number === no && x.open)) throw new FloorError(`table ${no} is not open`);
      const moves = breakTableMoves(t.tables, entries, no, rand);
      if (!moves) throw new FloorError(`not enough free seats to break table ${no}`);
      for (const m of moves) await storage.updateEntry(m.entryId, { ...m.to, bustSeq: null });
      await storage.updateTournament(t.id, { tables: t.tables.map((x) => (x.number === no ? { ...x, open: false } : x)) });
      return { result: moves, payload: { table: no, moves } };
    }),
  );

  app.post<{ Params: PT }>('/api/tournaments/:id/tables/:table/redraw', (req, reply) =>
    run(reply, Number(req.params.id), 'table.redraw', 'floor', async ({ t, entries }) => {
      const table = t.tables.find((x) => x.number === Number(req.params.table) && x.open);
      if (!table) throw new FloorError('pick an open table');
      const seats = redrawSeats(table, entries, rand);
      // Clear the seats first so swapping two players never hits the one-player-per-seat rule.
      for (const s of seats) await storage.updateEntry(s.entryId, { table: null, seat: null, bustSeq: null });
      for (const s of seats) await storage.updateEntry(s.entryId, { table: table.number, seat: s.seat, bustSeq: null });
      return { result: seats, payload: { table: table.number, seats } };
    }),
  );

  app.post<{ Params: P; Body: { on?: boolean } }>('/api/tournaments/:id/hand-for-hand', (req, reply) =>
    run(reply, Number(req.params.id), 'tournament.handForHand', 'floor', async ({ t }) => {
      const on = Boolean(req.body?.on);
      await storage.updateTournament(t.id, { handForHand: on });
      return { result: { on }, payload: { on } };
    }),
  );
}
