import type {
  ActionLogEntry,
  BlindStructure,
  ClockState,
  Entry,
  EntryPatch,
  Id,
  NewBlindStructure,
  NewPlayer,
  NewTournament,
  Player,
  Tournament,
  TournamentPatch,
  TournamentStatus,
} from '../../shared/types.js';

/**
 * Everything the app reads or writes goes through this interface, so the
 * SQLite adapter used on the venue laptop can be swapped for a hosted
 * Postgres adapter without touching the rest of the server.
 * Methods are async even where SQLite is not, because a network database is.
 */
export interface Storage {
  init(): Promise<void>;
  close(): Promise<void>;
  /** Runs `fn` so that all its writes land together or not at all. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  listPlayers(search?: string): Promise<Player[]>;
  getPlayer(id: Id): Promise<Player | null>;
  createPlayer(p: NewPlayer): Promise<Player>;
  updatePlayer(id: Id, p: Partial<NewPlayer>): Promise<Player | null>;

  listStructures(): Promise<BlindStructure[]>;
  createStructure(s: NewBlindStructure): Promise<BlindStructure>;

  listTournaments(): Promise<Tournament[]>;
  getTournament(id: Id): Promise<Tournament | null>;
  createTournament(t: NewTournament, clock: ClockState): Promise<Tournament>;
  updateTournamentClock(id: Id, clock: ClockState, status: TournamentStatus): Promise<void>;
  updateTournament(id: Id, patch: TournamentPatch): Promise<void>;

  /** Entries with the player's name filled in. */
  listEntries(tournamentId: Id): Promise<Entry[]>;
  createEntry(tournamentId: Id, playerId: Id, seat: { table: number; seat: number }): Promise<Entry>;
  updateEntry(id: Id, patch: EntryPatch): Promise<void>;

  appendAction(e: Omit<ActionLogEntry, 'id' | 'createdAt'>): Promise<ActionLogEntry>;
  listActions(tournamentId: Id): Promise<ActionLogEntry[]>;
}
