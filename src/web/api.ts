import type {
  BlindStructure,
  ClockCommand,
  Entry,
  MoneyConfig,
  NewPlayer,
  Player,
  Tournament,
  TournamentPatch,
} from '../shared/types';

type Seat = { table: number; seat: number };

/** A failed request. Status 409 means a rule blocked it and it can be retried with force. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
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
    money?: Partial<MoneyConfig>;
  }) => call<Tournament>('POST', '/api/tournaments', t),
  updateTournament: (id: number, patch: TournamentPatch) => call<unknown>('PATCH', `/api/tournaments/${id}`, patch),
  clock: (id: number, cmd: ClockCommand) => call<Tournament>('POST', `/api/tournaments/${id}/clock`, cmd),
  register: (id: number, playerId: number, force = false) =>
    call<Entry>('POST', `/api/tournaments/${id}/entries`, { playerId, force }),
  rebuy: (id: number, entryId: number, force = false) =>
    call<Seat & { rebuys: number }>('POST', `/api/tournaments/${id}/entries/${entryId}/rebuy`, { force }),
  undoRebuy: (id: number, entryId: number) => call<unknown>('POST', `/api/tournaments/${id}/entries/${entryId}/rebuy/undo`),
  addOn: (id: number, entryId: number, undo = false) =>
    call<unknown>('POST', `/api/tournaments/${id}/entries/${entryId}/add-on`, { undo }),
  markPaid: (id: number, entryId: number, paid = true) =>
    call<{ paidOut: number }>('POST', `/api/tournaments/${id}/entries/${entryId}/paid`, { paid }),
  bust: (id: number, entryId: number) => call<{ place: number }>('POST', `/api/tournaments/${id}/entries/${entryId}/bust`),
  restore: (id: number, entryId: number) => call<Seat>('POST', `/api/tournaments/${id}/entries/${entryId}/restore`),
  move: (id: number, entryId: number, table: number, seat?: number) =>
    call<Seat>('POST', `/api/tournaments/${id}/entries/${entryId}/move`, { table, seat }),
  addTable: (id: number, seats?: number) => call<{ number: number }>('POST', `/api/tournaments/${id}/tables`, { seats }),
  breakTable: (id: number, table: number) => call<unknown>('POST', `/api/tournaments/${id}/tables/${table}/break`),
  redraw: (id: number, table: number) => call<unknown>('POST', `/api/tournaments/${id}/tables/${table}/redraw`),
  handForHand: (id: number, on: boolean) => call<unknown>('POST', `/api/tournaments/${id}/hand-for-hand`, { on }),
};
