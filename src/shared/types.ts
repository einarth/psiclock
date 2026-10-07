export type Id = number;

export interface Player {
  id: Id;
  /** Short name or nickname shown on screens. The only required field. */
  name: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

export type NewPlayer = Pick<Player, 'name'> & Partial<Pick<Player, 'fullName' | 'email' | 'phone'>>;

export interface PlayLevel {
  kind: 'level';
  smallBlind: number;
  bigBlind: number;
  ante: number;
  minutes: number;
}

export interface BreakLevel {
  kind: 'break';
  minutes: number;
  /** Shown on screen during the break, e.g. "Colour up the 25 chips". */
  note?: string;
}

export type Level = PlayLevel | BreakLevel;

export interface BlindStructure {
  id: Id;
  name: string;
  levels: Level[];
}

export type NewBlindStructure = Omit<BlindStructure, 'id'>;

/**
 * The clock is stored as a fixed point plus whether it is running, so the
 * current level is always derived from the time rather than from a timer.
 * A server restart mid-level therefore loses nothing.
 */
export interface ClockState {
  running: boolean;
  /** Index of the level the clock was in at `anchorAt`. */
  levelIndex: number;
  /** Milliseconds elapsed in that level at `anchorAt`. */
  elapsedMs: number;
  /** Epoch ms when this state was recorded. */
  anchorAt: number;
}

export type TournamentStatus = 'setup' | 'running' | 'finished';

export interface TableConfig {
  number: number;
  seats: number;
  /** False once the table has been broken. */
  open: boolean;
}

/** One player's place in one tournament: their seat while alive, their bust order once out. */
export interface Entry {
  id: Id;
  tournamentId: Id;
  playerId: Id;
  playerName: string;
  table: number | null;
  seat: number | null;
  /** Order in which players busted (1 = first out); null while still in. */
  bustSeq: number | null;
  createdAt: string;
}

export interface Tournament {
  id: Id;
  name: string;
  status: TournamentStatus;
  buyIn: number;
  fee: number;
  startingStack: number;
  levels: Level[];
  clock: ClockState;
  theme: string;
  tables: TableConfig[];
  handForHand: boolean;
  createdAt: string;
}

export type NewTournament = Pick<Tournament, 'name' | 'buyIn' | 'fee' | 'startingStack' | 'levels'> &
  Partial<Pick<Tournament, 'theme' | 'tables'>>;

export interface ActionLogEntry {
  id: Id;
  tournamentId: Id | null;
  type: string;
  payload: unknown;
  actor: string;
  createdAt: string;
}

/** Commands a client sends to change the clock. */
export type ClockCommand =
  | { type: 'clock.start' }
  | { type: 'clock.pause' }
  | { type: 'clock.adjust'; deltaMs: number }
  | { type: 'clock.setLevel'; levelIndex: number };

/** Messages the server pushes over the WebSocket. */
export type ServerMessage =
  | { type: 'hello'; serverTime: number }
  | { type: 'tournament'; tournament: Tournament; entries: Entry[]; serverTime: number };
