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
import type { Role, User } from '../../shared/auth.js';
import type { LayoutConfig, ScreenLayout } from '../../shared/layout.js';

export interface NewUser {
  username: string;
  displayName: string;
  role: Role;
  passwordHash: string;
}

export type UserPatch = Partial<Pick<User, 'displayName' | 'role' | 'active'>> & { passwordHash?: string };

export interface Session {
  user: User;
  expiresAt: number;
}

/** An uploaded image, such as a sponsor logo. */
export interface Asset {
  id: Id;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

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
  /** Oldest first; with `types` and `limit`, the latest matching actions, newest first. */
  listActions(tournamentId: Id, opts?: { types?: string[]; limit?: number }): Promise<ActionLogEntry[]>;

  countUsers(): Promise<number>;
  listUsers(): Promise<User[]>;
  getUser(id: Id): Promise<User | null>;
  /** The user and their password hash, for checking a login. Usernames are matched case-insensitively. */
  getLogin(username: string): Promise<{ user: User; passwordHash: string } | null>;
  createUser(u: NewUser): Promise<User>;
  updateUser(id: Id, patch: UserPatch): Promise<User | null>;

  /** Sessions are stored by a hash of their token, never the token itself. */
  createSession(tokenHash: string, userId: Id, expiresAt: number): Promise<void>;
  getSession(tokenHash: string): Promise<Session | null>;
  extendSession(tokenHash: string, expiresAt: number): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteUserSessions(userId: Id): Promise<void>;

  listLayouts(): Promise<ScreenLayout[]>;
  getLayout(id: Id): Promise<ScreenLayout | null>;
  createLayout(name: string, config: LayoutConfig): Promise<ScreenLayout>;
  updateLayout(id: Id, name: string, config: LayoutConfig): Promise<ScreenLayout | null>;
  /** Tournaments using the layout fall back to the built-in one. */
  deleteLayout(id: Id): Promise<void>;

  listAssets(): Promise<Asset[]>;
  createAsset(name: string, mime: string, data: Uint8Array): Promise<Asset>;
  getAssetData(id: Id): Promise<{ asset: Asset; data: Uint8Array } | null>;
}
