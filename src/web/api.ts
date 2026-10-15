import type {
  BlindStructure,
  ClockCommand,
  Entry,
  Level,
  MoneyConfig,
  NewPlayer,
  Player,
  Tournament,
  TournamentPatch,
  ScreenState,
  TournamentTemplate,
} from '../shared/types';
import type { Role, User } from '../shared/auth';
import type { LayoutConfig, ScreenLayout } from '../shared/layout';

export interface Me {
  user: User | null;
  setupNeeded: boolean;
  setupAllowed: boolean;
}

export interface Asset {
  id: number;
  name: string;
  mime: string;
  size: number;
}

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
  // Signed out (or the session ran out): go to the sign-in page and come back here afterwards.
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  me: () => call<Me>('GET', '/api/auth/me'),
  setup: (u: { username: string; displayName: string; password: string }) =>
    call<{ user: User }>('POST', '/api/auth/setup', u),
  login: (username: string, password: string) => call<{ user: User }>('POST', '/api/auth/login', { username, password }),
  logout: () => call<unknown>('POST', '/api/auth/logout', {}),
  changePassword: (current: string, password: string) => call<unknown>('POST', '/api/auth/password', { current, password }),
  users: () => call<User[]>('GET', '/api/users'),
  createUser: (u: { username: string; displayName: string; role: Role; password: string }) =>
    call<User>('POST', '/api/users', u),
  updateUser: (id: number, patch: { displayName?: string; role?: Role; active?: boolean; password?: string }) =>
    call<User>('PATCH', `/api/users/${id}`, patch),
  layouts: () => call<ScreenLayout[]>('GET', '/api/layouts'),
  createLayout: (name: string, layout: LayoutConfig) => call<ScreenLayout>('POST', '/api/layouts', { name, layout }),
  saveLayout: (id: number, name: string, layout: LayoutConfig) =>
    call<ScreenLayout>('PUT', `/api/layouts/${id}`, { name, layout }),
  deleteLayout: (id: number) => call<unknown>('DELETE', `/api/layouts/${id}`, {}),
  assets: () => call<Asset[]>('GET', '/api/assets'),
  uploadAsset: async (file: File) => {
    const res = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? `Upload failed (${res.status})`, res.status);
    return data as Asset;
  },
  setScreen: (id: number, s: { scene?: ScreenState['scene']; seconds?: number; message?: string; autoMoves?: boolean }) =>
    call<ScreenState>('POST', `/api/tournaments/${id}/screen`, s),
  players: (search = '') => call<Player[]>('GET', `/api/players?search=${encodeURIComponent(search)}`),
  player: (id: number) => call<Player>('GET', `/api/players/${id}`),
  createPlayer: (p: NewPlayer) => call<Player>('POST', '/api/players', p),
  updatePlayer: (id: number, p: Partial<NewPlayer>) => call<Player>('PATCH', `/api/players/${id}`, p),
  structures: () => call<BlindStructure[]>('GET', '/api/structures'),
  tournaments: () => call<Tournament[]>('GET', '/api/tournaments'),
  createTournament: (t: {
    name: string;
    buyIn: number;
    startingStack: number;
    structureId: number;
    startsAt: string | null;
    templateId?: number;
    fromTournamentId?: number;
    theme: string;
    tableCount: number;
    seatsPerTable: number;
    money?: Partial<MoneyConfig>;
  }) => call<Tournament>('POST', '/api/tournaments', t),
  updateTournament: (id: number, patch: TournamentPatch) => call<unknown>('PATCH', `/api/tournaments/${id}`, patch),
  saveLevels: (id: number, levels: Level[], currentIndex: number, expectedIndex: number) =>
    call<unknown>('PUT', `/api/tournaments/${id}/levels`, { levels, currentIndex, expectedIndex }),
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
  handForHand: (id: number, on: boolean, pauseClock = false) =>
    call<{ on: boolean; clock: 'paused' | 'resumed' | 'unchanged' }>('POST', `/api/tournaments/${id}/hand-for-hand`, { on, pauseClock }),
  floorClock: (id: number, running: boolean) => call<{ running: boolean }>('POST', `/api/tournaments/${id}/clock/run`, { running }),
  templates: () => call<TournamentTemplate[]>('GET', '/api/templates'),
  saveTemplate: (name: string, tournamentId: number) => call<TournamentTemplate>('POST', '/api/templates', { name, tournamentId }),
  deleteTemplate: (id: number) => call<unknown>('DELETE', `/api/templates/${id}`, {}),
};
