import { describe, expect, it } from 'vitest';
import {
  breakTableMoves,
  fieldStats,
  finishingPlace,
  nextBalanceMove,
  playersAt,
  redrawSeats,
  seatForNewPlayer,
  tableToBreak,
} from './seating';
import type { Entry, TableConfig } from './types';

/** A repeatable random source so seat draws are the same on every run. */
function seeded(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

const tables = (n: number, seats = 9): TableConfig[] =>
  Array.from({ length: n }, (_, i) => ({ number: i + 1, seats, open: true }));

let nextId = 1;
const entry = (table: number | null, seat: number | null, bustSeq: number | null = null): Entry => ({
  id: nextId++,
  tournamentId: 1,
  playerId: nextId,
  playerName: `P${nextId}`,
  table,
  seat,
  bustSeq,
  createdAt: '',
});

function seatAll(t: TableConfig[], count: number, rand = seeded()) {
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const s = seatForNewPlayer(t, entries, rand)!;
    entries.push(entry(s.table, s.seat));
  }
  return entries;
}

describe('seating', () => {
  it('fills tables evenly with no seat used twice', () => {
    const t = tables(4);
    const entries = seatAll(t, 30);
    const counts = t.map((x) => playersAt(entries, x.number).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    const seats = entries.map((e) => `${e.table}-${e.seat}`);
    expect(new Set(seats).size).toBe(30);
    expect(entries.every((e) => e.seat! >= 1 && e.seat! <= 9)).toBe(true);
  });

  it('returns null when every seat is taken', () => {
    const t = tables(1, 2);
    const entries = seatAll(t, 2);
    expect(seatForNewPlayer(t, entries, seeded())).toBeNull();
  });

  it('asks for a balance move only when tables differ by two or more', () => {
    const t = tables(2);
    const a = [entry(1, 1), entry(1, 2), entry(1, 3), entry(2, 1), entry(2, 2)];
    expect(nextBalanceMove(t, a)).toBeNull();
    const b = [...a, entry(1, 4)];
    expect(nextBalanceMove(t, b)).toEqual({ from: 1, to: 2 });
    const busted = [...b.slice(0, 5).map((e) => (e.table === 2 && e.seat === 2 ? { ...e, bustSeq: 1 } : e)), b[5]];
    expect(nextBalanceMove(t, busted)).toEqual({ from: 1, to: 2 });
  });

  it('breaks the highest table once the others can seat everyone', () => {
    const t = tables(3);
    const entries = seatAll(t, 19);
    expect(tableToBreak(t, entries)).toBeNull();
    const fewer = entries.map((e, i) => (i < 1 ? { ...e, bustSeq: 1 } : e));
    expect(tableToBreak(t, fewer)).toBe(3);
  });

  it('moves everyone off a broken table into free seats, keeping tables balanced', () => {
    const t = tables(3);
    const entries = seatAll(t, 15);
    const moves = breakTableMoves(t, entries, 3, seeded(7))!;
    expect(moves).toHaveLength(playersAt(entries, 3).length);
    const after = entries.map((e) => {
      const m = moves.find((x) => x.entryId === e.id);
      return m ? { ...e, ...m.to } : e;
    });
    expect(playersAt(after, 3)).toHaveLength(0);
    const counts = [1, 2].map((n) => playersAt(after, n).length);
    expect(counts.sort()).toEqual([7, 8]);
    expect(new Set(after.map((e) => `${e.table}-${e.seat}`)).size).toBe(15);
  });

  it('refuses to break a table when there is no room', () => {
    const t = tables(2, 2);
    expect(breakTableMoves(t, seatAll(t, 4), 2, seeded())).toBeNull();
  });

  it('redraws a table into distinct seats', () => {
    const t = tables(1);
    const entries = seatAll(t, 6);
    const seats = redrawSeats(t[0], entries, seeded(3)).map((s) => s.seat);
    expect(new Set(seats).size).toBe(6);
  });

  it('works out finishing places from the bust order', () => {
    const e = [entry(1, 1, 1), entry(1, 2, 2), entry(1, 3), entry(1, 4)];
    expect(finishingPlace(e, e[0])).toBe(4);
    expect(finishingPlace(e, e[1])).toBe(3);
    expect(finishingPlace(e, e[2])).toBeNull();
    const done = e.map((x, i) => (i === 3 ? { ...x, bustSeq: 3 } : x));
    expect(finishingPlace(done, done[3])).toBe(2);
    expect(finishingPlace(done, done[2])).toBe(1);
  });

  it('computes players left and the average stack', () => {
    const e = [entry(1, 1, 1), entry(1, 2), entry(1, 3), entry(1, 4)];
    expect(fieldStats(e, 30000)).toEqual({ entries: 4, remaining: 3, averageStack: 40000 });
  });
});
