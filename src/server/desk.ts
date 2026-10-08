import type { FastifyInstance } from 'fastify';
import type { Storage } from './storage/storage.js';
import { ActionError, type RunAction } from './actions.js';
import { clockAt } from '../shared/clock.js';
import { defaultMoney, payoutsFor, withinLevel } from '../shared/money.js';
import { finishingPlace, freeSeats, isAlive, seatForNewPlayer, type Rand } from '../shared/seating.js';
import type { MoneyConfig, TournamentPatch } from '../shared/types.js';

const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Some or all money settings: known keys only, each a whole number of 0 or more. */
export function validMoney(m: unknown): m is Partial<MoneyConfig> {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  return Object.entries(m).every(([k, v]) => k in defaultMoney && isCount(v));
}

function validPayouts(p: unknown): p is number[] | null {
  if (p === null) return true;
  if (!Array.isArray(p) || p.length === 0) return false;
  if (!p.every((x) => typeof x === 'number' && x > 0)) return false;
  return Math.abs(p.reduce((a, b) => a + b, 0) - 100) < 0.05;
}

/** Tournament settings, rebuys, add-ons and prize payments. */
export function registerDeskRoutes(app: FastifyInstance, storage: Storage, run: RunAction, rand: Rand = Math.random) {
  type P = { id: string };
  type PE = { id: string; entryId: string };

  app.patch<{ Params: P; Body: TournamentPatch }>('/api/tournaments/:id', (req, reply) =>
    run(reply, Number(req.params.id), 'tournament.update', 'director', async ({ t }) => {
      const b = req.body ?? {};
      const patch: TournamentPatch = {};
      if (b.name !== undefined) {
        if (!b.name.trim()) throw new ActionError('name cannot be blank');
        patch.name = b.name.trim();
      }
      for (const k of ['buyIn', 'fee', 'startingStack'] as const) {
        if (b[k] !== undefined) {
          if (!isCount(b[k])) throw new ActionError(`${k} must be a whole number of 0 or more`);
          patch[k] = b[k];
        }
      }
      if (b.theme !== undefined) patch.theme = String(b.theme);
      if (b.money !== undefined) {
        if (!validMoney(b.money)) throw new ActionError('money settings must all be whole numbers of 0 or more');
        patch.money = { ...t.money, ...b.money };
      }
      if (b.payouts !== undefined) {
        if (!validPayouts(b.payouts)) throw new ActionError('payout percentages must be positive and add up to 100');
        patch.payouts = b.payouts;
      }
      await storage.updateTournament(Number(req.params.id), patch);
      return { result: patch, payload: patch };
    }),
  );

  app.post<{ Params: PE; Body: { force?: boolean } }>('/api/tournaments/:id/entries/:entryId/rebuy', (req, reply) =>
    run(reply, Number(req.params.id), 'entry.rebuy', 'desk', async ({ t, entries, entry }) => {
      const e = entry(req.params.entryId);
      const m = t.money;
      if (m.rebuyPrice === 0) throw new ActionError('this tournament has no rebuys');
      const level = clockAt(t.levels, t.clock, Date.now()).levelNumber;
      if (!req.body?.force && !withinLevel(level, m.rebuyUntilLevel)) {
        throw new ActionError(`rebuys closed after level ${m.rebuyUntilLevel}`, 409);
      }
      let seat = { table: e.table, seat: e.seat };
      if (!isAlive(e)) {
        // A busted player who rebuys goes back to their seat if it is still free.
        const table = t.tables.find((x) => x.number === e.table && x.open);
        const same = table && e.seat !== null && freeSeats(table, entries).includes(e.seat);
        const next = same ? { table: e.table!, seat: e.seat! } : seatForNewPlayer(t.tables, entries, rand);
        if (!next) throw new ActionError('no free seat; add a table first');
        seat = next;
      }
      await storage.updateEntry(e.id, { ...seat, bustSeq: null, rebuys: e.rebuys + 1 });
      return { result: { rebuys: e.rebuys + 1, ...seat }, payload: { entryId: e.id, rebuys: e.rebuys + 1, ...seat } };
    }),
  );

  app.post<{ Params: PE }>('/api/tournaments/:id/entries/:entryId/rebuy/undo', (req, reply) =>
    run(reply, Number(req.params.id), 'entry.rebuyUndo', 'desk', async ({ entry }) => {
      const e = entry(req.params.entryId);
      if (e.rebuys === 0) throw new ActionError(`${e.playerName} has no rebuys`);
      await storage.updateEntry(e.id, { rebuys: e.rebuys - 1 });
      return { result: { rebuys: e.rebuys - 1 }, payload: { entryId: e.id, rebuys: e.rebuys - 1 } };
    }),
  );

  app.post<{ Params: PE; Body: { undo?: boolean } }>('/api/tournaments/:id/entries/:entryId/add-on', (req, reply) =>
    run(reply, Number(req.params.id), 'entry.addOn', 'desk', async ({ t, entry }) => {
      const e = entry(req.params.entryId);
      const addOn = !req.body?.undo;
      if (addOn) {
        if (t.money.addOnPrice === 0) throw new ActionError('this tournament has no add-on');
        if (e.addOn) throw new ActionError(`${e.playerName} already has the add-on`);
        if (!isAlive(e)) throw new ActionError(`${e.playerName} is out`);
      }
      await storage.updateEntry(e.id, { addOn });
      return { result: { addOn }, payload: { entryId: e.id, addOn } };
    }),
  );

  app.post<{ Params: PE; Body: { paid?: boolean } }>('/api/tournaments/:id/entries/:entryId/paid', (req, reply) =>
    run(reply, Number(req.params.id), 'entry.paid', 'desk', async ({ t, entries, entry }) => {
      const e = entry(req.params.entryId);
      const place = finishingPlace(entries, e);
      const amount = place ? (payoutsFor(t, entries)[place - 1] ?? 0) : 0;
      if (req.body?.paid !== false && amount === 0) throw new ActionError(`${e.playerName} has no prize to pay yet`);
      const paidOut = req.body?.paid === false ? 0 : amount;
      await storage.updateEntry(e.id, { paidOut });
      return { result: { paidOut }, payload: { entryId: e.id, place, paidOut } };
    }),
  );

  // Results as a spreadsheet-friendly CSV: place, name, contact details, rebuys, add-on, prize.
  app.get<{ Params: P }>('/api/tournaments/:id/results.csv', async (req, reply) => {
    const t = await storage.getTournament(Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'tournament not found' });
    const entries = await storage.listEntries(t.id);
    const players = new Map((await storage.listPlayers()).map((p) => [p.id, p]));
    const prizes = payoutsFor(t, entries);
    const rows = entries
      .map((e) => ({ e, place: finishingPlace(entries, e) }))
      .sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || a.e.id - b.e.id);
    const cell = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['Place', 'Name', 'Full name', 'Email', 'Phone', 'Rebuys', 'Add-on', 'Prize', 'Paid'],
      ...rows.map(({ e, place }) => {
        const p = players.get(e.playerId);
        return [
          place ?? 'still in',
          e.playerName,
          p?.fullName,
          p?.email,
          p?.phone,
          e.rebuys,
          e.addOn ? 'yes' : '',
          place && prizes[place - 1] ? prizes[place - 1] : '',
          e.paidOut || '',
        ];
      }),
    ];
    const safeName = t.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'results';
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.csv"`)
      .send('﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n'));
  });
}
