import type { BlindStructure, ClockCommand, Entry, NewPlayer, Player, Tournament } from '../shared/types';

type Seat = { table: number; seat: number };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  players: (search = '') => call<Player[]>('GET', `/api/players?search=${encodeURIComponent(search)}`),
  createPlayer: (p: NewPlayer) => call<Player>('POST', '/api/players', p),
  updatePlayer: (id: number, p: Partial<NewPlayer>) => call<Player>('PATCH', `/api/players/${id}`, p),
  structures: () => call<BlindStructure[]>('GET', '/api/structures'),
  tournaments: () => call<Tournament[]>('GET', '/api/tournaments'),
  createTournament: (t: {
    name: string;
    buyIn: number;
    fee: number;
    startingStack: number;
    structureId: number;
    theme: string;
    tableCount: number;
    seatsPerTable: number;
  }) => call<Tournament>('POST', '/api/tournaments', t),
  clock: (id: number, cmd: ClockCommand) => call<Tournament>('POST', `/api/tournaments/${id}/clock`, cmd),
  register: (id: number, playerId: number) => call<Entry>('POST', `/api/tournaments/${id}/entries`, { playerId }),
  bust: (id: number, entryId: number) => call<{ place: number }>('POST', `/api/tournaments/${id}/entries/${entryId}/bust`),
  restore: (id: number, entryId: number) => call<Seat>('POST', `/api/tournaments/${id}/entries/${entryId}/restore`),
  move: (id: number, entryId: number, table: number, seat?: number) =>
    call<Seat>('POST', `/api/tournaments/${id}/entries/${entryId}/move`, { table, seat }),
  addTable: (id: number, seats?: number) => call<{ number: number }>('POST', `/api/tournaments/${id}/tables`, { seats }),
  breakTable: (id: number, table: number) => call<unknown>('POST', `/api/tournaments/${id}/tables/${table}/break`),
  redraw: (id: number, table: number) => call<unknown>('POST', `/api/tournaments/${id}/tables/${table}/redraw`),
  handForHand: (id: number, on: boolean) => call<unknown>('POST', `/api/tournaments/${id}/hand-for-hand`, { on }),
};
