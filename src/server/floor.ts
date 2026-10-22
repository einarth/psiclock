import type { FastifyInstance } from 'fastify';
import type { Storage } from './storage/storage.js';
import { ActionError, type RunAction } from './actions.js';
import {
  breakMovesError,
  breakTableMoves,
  finishingPlace,
  freeSeats,
  isAlive,
  redrawSeats,
  seatForNewPlayer,
  type Rand,
  type Seat,
} from '../shared/seating.js';
import { applyClockCommand, clockAt } from '../shared/clock.js';
import { withinLevel } from '../shared/money.js';

/** Registration, seating, bustouts and table moves. */
export function registerFloorRoutes(app: FastifyInstance, storage: Storage, run: RunAction, rand: Rand = Math.random) {
  type P = { id: string };
  type PE = { id: string; entryId: string };
  type PT = { id: string; table: string };

  app.post<{ Params: P; Body: { playerId?: number; force?: boolean } }>('/api/tournaments/:id/entries', (req, reply) =>
    run(reply.code(201), Number(req.params.id), 'entry.create', 'desk', async ({ t, entries }) => {
      const player = await storage.getPlayer(Number(req.body?.playerId));
      if (!player) throw new ActionError('player not found', 404);
      if (t.status === 'finished') throw new ActionError('the tournament has finished');
      const level = clockAt(t.levels, t.clock, Date.now()).levelNumber;
      if (!req.body?.force && !withinLevel(level, t.money.lateRegUntilLevel)) {
        throw new ActionError(`registration closed after level ${t.money.lateRegUntilLevel}`, 409);
      }
      const seat = seatForNewPlayer(t.tables, entries, rand);
      if (!seat) throw new ActionError('every seat is taken; add a table first');
      const entry = await storage.createEntry(t.id, player.id, seat);
      return { result: entry, payload: { entryId: entry.id, playerId: player.id, ...seat } };
    }),
  );

  app.post<{ Params: PE }>('/api/tournaments/:id/entries/:entryId/bust', (req, reply) =>
    run(reply, Number(req.params.id), 'entry.bust', 'floor', async ({ t, entries, entry }) => {
      const e = entry(req.params.entryId);
      if (t.status === 'finished') throw new ActionError('the tournament has finished');
      if (!isAlive(e)) throw new ActionError(`${e.playerName} is already out`);
      if (entries.filter(isAlive).length === 1) throw new ActionError(`${e.playerName} is the last player left`);
      const bustSeq = Math.max(0, ...entries.map((x) => x.bustSeq ?? 0)) + 1;
      // The seat is kept on the record so an undo can put the player back where they sat.
      await storage.updateEntry(e.id, { table: e.table, seat: e.seat, bustSeq });
      const after = entries.map((x) => (x.id === e.id ? { ...x, bustSeq } : x));
      const place = finishingPlace(after, { ...e, bustSeq });
      // One player left: the tournament is over. The clock stops where it is.
      const finished = after.filter(isAlive).length === 1;
      if (finished) {
        await storage.updateTournamentClock(t.id, applyClockCommand(t.levels, t.clock, { type: 'clock.pause' }, Date.now()), 'finished');
      }
      return { result: { place, finished }, payload: { entryId: e.id, table: e.table, seat: e.seat, place, finished } };
    }),
  );

  app.post<{ Params: PE }>('/api/tournaments/:id/entries/:entryId/restore', (req, reply) =>
    run(reply, Number(req.params.id), 'entry.restore', 'floor', async ({ t, entries, entry }) => {
      const e = entry(req.params.entryId);
      if (isAlive(e)) throw new ActionError(`${e.playerName} is not out`);
      const table = t.tables.find((x) => x.number === e.table);
      const sameSeatFree = table?.open && e.seat !== null && freeSeats(table, entries).includes(e.seat);
      const seat = sameSeatFree ? { table: e.table!, seat: e.seat! } : seatForNewPlayer(t.tables, entries, rand);
      if (!seat) throw new ActionError('no free seat to put the player back in');
      await storage.updateEntry(e.id, { ...seat, bustSeq: null });
      // Undoing the bust that left a winner reopens the tournament, with the clock still paused.
      if (t.status === 'finished' && entries.filter(isAlive).length === 1) await storage.updateTournament(t.id, { status: 'running' });
      return { result: seat, payload: { entryId: e.id, ...seat } };
    }),
  );

  app.post<{ Params: PE; Body: { table?: number; seat?: number } }>(
    '/api/tournaments/:id/entries/:entryId/move',
    (req, reply) =>
      run(reply, Number(req.params.id), 'entry.move', 'floor', async ({ t, entries, entry }) => {
        const e = entry(req.params.entryId);
        if (!isAlive(e)) throw new ActionError(`${e.playerName} is out`);
        const table = t.tables.find((x) => x.number === Number(req.body?.table) && x.open);
        if (!table) throw new ActionError('pick an open table');
        const free = freeSeats(table, entries);
        const seat = req.body?.seat ?? free[Math.floor(rand() * free.length)];
        if (seat === undefined || !free.includes(seat)) throw new ActionError(`no free seat ${seat ?? ''} at table ${table.number}`);
        await storage.updateEntry(e.id, { table: table.number, seat, bustSeq: null });
        const to = { table: table.number, seat };
        return { result: to, payload: { entryId: e.id, from: { table: e.table, seat: e.seat }, to } };
      }),
  );

  app.post<{ Params: P; Body: { seats?: number } }>('/api/tournaments/:id/tables', (req, reply) =>
    run(reply, Number(req.params.id), 'table.add', 'floor', async ({ t }) => {
      const seats = Number(req.body?.seats ?? t.tables.at(-1)?.seats ?? 9);
      if (!(seats >= 2 && seats <= 12)) throw new ActionError('a table needs 2 to 12 seats');
      const number = Math.max(0, ...t.tables.map((x) => x.number)) + 1;
      await storage.updateTournament(t.id, { tables: [...t.tables, { number, seats, open: true }] });
      return { result: { number, seats }, payload: { number, seats } };
    }),
  );

  // The floor may send its own seats for the moved players (body.moves); otherwise seats are drawn.
  app.post<{ Params: PT; Body: { moves?: { entryId: number; to: Seat }[] } }>('/api/tournaments/:id/tables/:table/break', (req, reply) =>
    run(reply, Number(req.params.id), 'table.break', 'floor', async ({ t, entries }) => {
      const no = Number(req.params.table);
      if (!t.tables.some((x) => x.number === no && x.open)) throw new ActionError(`table ${no} is not open`);
      const chosen = req.body?.moves;
      if (chosen !== undefined) {
        const wellFormed =
          Array.isArray(chosen) &&
          chosen.every((m) => m && Number.isInteger(m.entryId) && m.to && Number.isInteger(m.to.table) && Number.isInteger(m.to.seat));
        const error = wellFormed ? breakMovesError(t.tables, entries, no, chosen) : 'moves must list an entry and a table and seat for each';
        if (error) throw new ActionError(error);
      }
      const moves = chosen?.map((m) => ({ entryId: m.entryId, to: { table: m.to.table, seat: m.to.seat } })) ?? breakTableMoves(t.tables, entries, no, rand);
      if (!moves) throw new ActionError(`not enough free seats to break table ${no}`);
      for (const m of moves) await storage.updateEntry(m.entryId, { ...m.to, bustSeq: null });
      await storage.updateTournament(t.id, {
        tables: t.tables.map((x) => (x.number === no ? { ...x, open: false } : x)),
        // Put the moves on the big screens for a minute so players can find their new seats.
        ...(t.screen.autoMoves && moves.length ? { screen: { ...t.screen, scene: 'moves' as const, until: Date.now() + 60_000 } } : {}),
      });
      return { result: moves, payload: { table: no, moves } };
    }),
  );

  app.post<{ Params: PT }>('/api/tournaments/:id/tables/:table/redraw', (req, reply) =>
    run(reply, Number(req.params.id), 'table.redraw', 'floor', async ({ t, entries }) => {
      const table = t.tables.find((x) => x.number === Number(req.params.table) && x.open);
      if (!table) throw new ActionError('pick an open table');
      const seats = redrawSeats(table, entries, rand);
      // Clear the seats first so swapping two players never hits the one-player-per-seat rule.
      for (const s of seats) await storage.updateEntry(s.entryId, { table: null, seat: null, bustSeq: null });
      for (const s of seats) await storage.updateEntry(s.entryId, { table: table.number, seat: s.seat, bustSeq: null });
      return { result: seats, payload: { table: table.number, seats } };
    }),
  );

  /**
   * Hand-for-hand on or off. Turning it on can pause the clock; turning it
   * off restarts a paused clock, since play goes back to normal straight away.
   */
  app.post<{ Params: P; Body: { on?: boolean; pauseClock?: boolean } }>('/api/tournaments/:id/hand-for-hand', (req, reply) =>
    run(reply, Number(req.params.id), 'tournament.handForHand', 'floor', async ({ t }) => {
      const on = Boolean(req.body?.on);
      const now = Date.now();
      const view = clockAt(t.levels, t.clock, now);
      const live = t.status === 'running' && !view.finished;
      const command =
        on && req.body?.pauseClock && view.running ? 'clock.pause' : !on && live && !view.running ? 'clock.start' : null;
      if (command) await storage.updateTournamentClock(t.id, applyClockCommand(t.levels, t.clock, { type: command }, now), t.status);
      await storage.updateTournament(t.id, { handForHand: on });
      const clock = command === 'clock.pause' ? 'paused' : command === 'clock.start' ? 'resumed' : 'unchanged';
      return { result: { on, clock }, payload: { on, clock } };
    }),
  );

  // Floor staff may pause and resume a running tournament's clock. Starting it,
  // changing levels and adjusting time stay with the director.
  // End the tournament with players still in, when they agree a deal; or reopen it.
  app.post<{ Params: P; Body: { finished?: boolean } }>('/api/tournaments/:id/finish', (req, reply) =>
    run(reply, Number(req.params.id), 'tournament.finish', 'director', async ({ t, entries }) => {
      const finished = req.body?.finished !== false;
      const alive = entries.filter(isAlive).length;
      if (finished) {
        if (t.status !== 'running') throw new ActionError('only a running tournament can be ended');
        const clock = applyClockCommand(t.levels, t.clock, { type: 'clock.pause' }, Date.now());
        await storage.updateTournamentClock(t.id, clock, 'finished');
      } else {
        if (t.status !== 'finished') throw new ActionError('the tournament has not finished');
        if (alive < 2) throw new ActionError('one player is left; undo the last bust on the Floor page instead');
        await storage.updateTournament(t.id, { status: 'running' });
      }
      return { result: { finished, playersLeft: alive }, payload: { finished, playersLeft: alive } };
    }),
  );

  app.post<{ Params: P; Body: { running?: boolean } }>('/api/tournaments/:id/clock/run', (req, reply) =>
    run(reply, Number(req.params.id), 'tournament.floorClock', 'floor', async ({ t }) => {
      const running = Boolean(req.body?.running);
      const now = Date.now();
      const view = clockAt(t.levels, t.clock, now);
      if (t.status !== 'running' || view.finished) throw new ActionError('the director has to start the tournament first');
      if (view.running !== running) {
        const command = running ? 'clock.start' : 'clock.pause';
        await storage.updateTournamentClock(t.id, applyClockCommand(t.levels, t.clock, { type: command }, now), t.status);
      }
      return { result: { running }, payload: { running } };
    }),
  );
}
