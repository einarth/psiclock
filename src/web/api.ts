import type { BlindStructure, ClockCommand, NewPlayer, Player, Tournament } from '../shared/types';

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
  }) => call<Tournament>('POST', '/api/tournaments', t),
  clock: (id: number, cmd: ClockCommand) => call<Tournament>('POST', `/api/tournaments/${id}/clock`, cmd),
};
