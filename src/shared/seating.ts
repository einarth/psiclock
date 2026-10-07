import type { Entry, TableConfig } from './types.js';

/**
 * Seating rules, written as pure functions so they can be tested without a
 * server. They follow TDA practice: random seat draws, new players go to the
 * shortest table, tables are balanced when they differ by two or more, and
 * tables are broken in a fixed order (highest number first).
 */

export type Rand = () => number;

export interface Seat {
  table: number;
  seat: number;
}

const pick = <T>(items: T[], rand: Rand): T => items[Math.floor(rand() * items.length)];

export const isAlive = (e: Entry) => e.bustSeq === null;

export const openTables = (tables: TableConfig[]) => tables.filter((t) => t.open);

export function playersAt(entries: Entry[], table: number): Entry[] {
  return entries.filter((e) => isAlive(e) && e.table === table).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
}

export function freeSeats(table: TableConfig, entries: Entry[]): number[] {
  const taken = new Set(playersAt(entries, table.number).map((e) => e.seat));
  return Array.from({ length: table.seats }, (_, i) => i + 1).filter((s) => !taken.has(s));
}

/** A random free seat at one of the shortest open tables, or null when every seat is taken. */
export function seatForNewPlayer(tables: TableConfig[], entries: Entry[], rand: Rand, exclude?: number): Seat | null {
  const candidates = openTables(tables)
    .filter((t) => t.number !== exclude && freeSeats(t, entries).length > 0)
    .map((t) => ({ t, count: playersAt(entries, t.number).length }));
  if (candidates.length === 0) return null;
  const fewest = Math.min(...candidates.map((c) => c.count));
  const table = pick(
    candidates.filter((c) => c.count === fewest),
    rand,
  ).t;
  return { table: table.number, seat: pick(freeSeats(table, entries), rand) };
}

export interface BalanceMove {
  from: number;
  to: number;
}

/**
 * The next move needed to balance tables, or null if they are balanced.
 * Moves one player from the fullest table to the shortest one.
 */
export function nextBalanceMove(tables: TableConfig[], entries: Entry[]): BalanceMove | null {
  const counts = openTables(tables).map((t) => ({ t, count: playersAt(entries, t.number).length }));
  if (counts.length < 2) return null;
  const most = counts.reduce((a, b) => (b.count > a.count ? b : a));
  const least = counts.reduce((a, b) => (b.count < a.count ? b : a));
  if (most.count - least.count < 2) return null;
  return { from: most.t.number, to: least.t.number };
}

/** The table to break next (highest open number) if the others can seat everyone, else null. */
export function tableToBreak(tables: TableConfig[], entries: Entry[]): number | null {
  const open = openTables(tables);
  if (open.length < 2) return null;
  const last = open.reduce((a, b) => (b.number > a.number ? b : a));
  const capacity = open.filter((t) => t !== last).reduce((sum, t) => sum + t.seats, 0);
  return entries.filter(isAlive).length <= capacity ? last.number : null;
}

/**
 * Seats for every player at a table being broken, one at a time into the
 * shortest remaining table, so the room stays balanced.
 */
export function breakTableMoves(
  tables: TableConfig[],
  entries: Entry[],
  tableNo: number,
  rand: Rand,
): { entryId: number; to: Seat }[] | null {
  const remaining = tables.map((t) => (t.number === tableNo ? { ...t, open: false } : t));
  let working = entries.map((e) => ({ ...e }));
  const moves: { entryId: number; to: Seat }[] = [];
  for (const e of playersAt(working, tableNo)) {
    const to = seatForNewPlayer(remaining, working, rand);
    if (!to) return null;
    moves.push({ entryId: e.id, to });
    working = working.map((w) => (w.id === e.id ? { ...w, table: to.table, seat: to.seat } : w));
  }
  return moves;
}

/** A random new seat order for the players at a table, e.g. for the final table draw. */
export function redrawSeats(table: TableConfig, entries: Entry[], rand: Rand): { entryId: number; seat: number }[] {
  const players = playersAt(entries, table.number);
  const seats = Array.from({ length: table.seats }, (_, i) => i + 1);
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  return players.map((e, i) => ({ entryId: e.id, seat: seats[i] }));
}

/**
 * Finishing place for a busted entry: the last player out is placed just
 * behind everyone still alive, the first player out is last.
 */
export function finishingPlace(entries: Entry[], entry: Entry): number | null {
  const alive = entries.filter(isAlive).length;
  if (entry.bustSeq === null) return alive === 1 ? 1 : null;
  const bustedLater = entries.filter((e) => e.bustSeq !== null && e.bustSeq > entry.bustSeq!).length;
  return alive + bustedLater + 1;
}

export interface FieldStats {
  entries: number;
  remaining: number;
  averageStack: number;
}

export function fieldStats(entries: Entry[], startingStack: number): FieldStats {
  const remaining = entries.filter(isAlive).length;
  return {
    entries: entries.length,
    remaining,
    averageStack: remaining ? Math.round((entries.length * startingStack) / remaining) : 0,
  };
}
