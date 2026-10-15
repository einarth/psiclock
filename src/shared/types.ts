import type { LayoutConfig } from './layout.js';

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
  rebuys: number;
  addOn: boolean;
  /** Prize money handed to the player; 0 until the desk marks it paid. */
  paidOut: number;
  createdAt: string;
}

/** Rebuy, add-on, late registration and payout rules. A limit of 0 means no limit. */
export interface MoneyConfig {
  /** Rebuys are switched on explicitly; a freezeout leaves this off. */
  allowRebuys: boolean;
  allowAddOn: boolean;
  rebuyPrice: number;
  rebuyFee: number;
  rebuyChips: number;
  /** Rebuys are allowed up to the end of this level; 0 = for the whole tournament. */
  rebuyUntilLevel: number;
  addOnPrice: number;
  addOnFee: number;
  addOnChips: number;
  /** Registration closes after this level (including the break that follows it); 0 = never. */
  lateRegUntilLevel: number;
  /** The prize pool is at least this much. */
  guarantee: number;
  /** Payouts are rounded down to a multiple of this; the remainder goes to first place. */
  rounding: number;
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
  money: MoneyConfig;
  /** Percent of the prize pool per place, set by hand; null = use the suggested table. */
  payouts: number[] | null;
  /** Saved big-screen layout; null = the built-in one. */
  layoutId: Id | null;
  screen: ScreenState;
  /** When play is planned to start (ISO time); the big screen counts down to it. */
  startsAt: string | null;
  /** The prize pool set by hand; null = what the players paid in (or the guarantee, if larger). */
  prizePoolOverride: number | null;
  createdAt: string;
}

/** What the big screens show. Anything but the clock can return to the clock by itself at `until`. */
export type Scene = 'clock' | 'seating' | 'moves' | 'payouts' | 'message';

export interface ScreenState {
  scene: Scene;
  message?: string;
  /** Epoch ms when the screens go back to the clock; null = stay. */
  until?: number | null;
  /** Show player moves for a minute whenever a table is broken. */
  autoMoves: boolean;
}

export const defaultScreen: ScreenState = { scene: 'clock', until: null, autoMoves: true };

/** A player moved by the floor, for the moves screen. */
export interface Move {
  at: string;
  playerName: string;
  from: { table: number | null; seat: number | null } | null;
  to: { table: number; seat: number };
  reason: 'balance' | 'break' | 'redraw';
}

export type NewTournament = Pick<Tournament, 'name' | 'buyIn' | 'fee' | 'startingStack' | 'levels'> &
  Partial<Pick<Tournament, 'theme' | 'tables' | 'money' | 'payouts' | 'layoutId' | 'startsAt'>>;

/** What a new tournament copies from a template: everything but the name, players and clock. */
export interface TemplateConfig {
  buyIn: number;
  fee: number;
  startingStack: number;
  levels: Level[];
  tableCount: number;
  seatsPerTable: number;
  money: MoneyConfig;
  payouts: number[] | null;
  layoutId: Id | null;
}

/** A saved starting point for new tournaments. */
export interface TournamentTemplate extends TemplateConfig {
  id: Id;
  name: string;
  updatedAt: string;
}

/** Fields the director can change after the tournament is created. */
export type TournamentPatch = Partial<
  Pick<
    Tournament,
    | 'name'
    | 'buyIn'
    | 'fee'
    | 'startingStack'
    | 'theme'
    | 'tables'
    | 'handForHand'
    | 'money'
    | 'payouts'
    | 'layoutId'
    | 'screen'
    | 'startsAt'
    | 'prizePoolOverride'
    | 'status'
  >
>;

export type EntryPatch = Partial<Pick<Entry, 'table' | 'seat' | 'bustSeq' | 'rebuys' | 'addOn' | 'paidOut'>>;

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
  | {
      type: 'tournament';
      tournament: Tournament;
      entries: Entry[];
      /** The layout in force for this tournament's big screens. */
      layout: LayoutConfig;
      /** Recent player moves, newest first. */
      moves: Move[];
      serverTime: number;
    };
