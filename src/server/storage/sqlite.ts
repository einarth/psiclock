import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ActionLogEntry,
  BlindStructure,
  ClockState,
  Level,
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
  TemplateConfig,
  TournamentTemplate,
} from '../../shared/types.js';
import { defaultScreen } from '../../shared/types.js';
import { normalizeMoney } from '../../shared/money.js';
import type { Role, User } from '../../shared/auth.js';
import type { LayoutConfig, ScreenLayout } from '../../shared/layout.js';
import type { Asset, NewUser, Storage, UserPatch } from './storage.js';

type Row = Record<string, unknown>;

/** Schema changes are appended here; each runs once, in order. */
const migrations: string[] = [
  `CREATE TABLE players (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     full_name TEXT,
     email TEXT,
     phone TEXT,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE INDEX players_name ON players(name COLLATE NOCASE);
   CREATE TABLE blind_structures (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     levels TEXT NOT NULL
   );
   CREATE TABLE tournaments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'setup',
     buy_in INTEGER NOT NULL,
     fee INTEGER NOT NULL,
     starting_stack INTEGER NOT NULL,
     levels TEXT NOT NULL,
     clock TEXT NOT NULL,
     theme TEXT NOT NULL DEFAULT 'classic',
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE TABLE action_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tournament_id INTEGER REFERENCES tournaments(id),
     type TEXT NOT NULL,
     payload TEXT NOT NULL,
     actor TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE INDEX action_log_tournament ON action_log(tournament_id, id);`,
  `ALTER TABLE tournaments ADD COLUMN tables TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE tournaments ADD COLUMN hand_for_hand INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
     player_id INTEGER NOT NULL REFERENCES players(id),
     table_no INTEGER,
     seat_no INTEGER,
     bust_seq INTEGER,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE INDEX entries_tournament ON entries(tournament_id);
   CREATE UNIQUE INDEX entries_seat ON entries(tournament_id, table_no, seat_no)
     WHERE bust_seq IS NULL AND table_no IS NOT NULL;`,
  `ALTER TABLE tournaments ADD COLUMN money TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE tournaments ADD COLUMN payouts TEXT;
   ALTER TABLE entries ADD COLUMN rebuys INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE entries ADD COLUMN add_on INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE entries ADD COLUMN paid_out INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     display_name TEXT NOT NULL,
     role TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id),
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE layouts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     config TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE TABLE assets (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     mime TEXT NOT NULL,
     data BLOB NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   ALTER TABLE tournaments ADD COLUMN layout_id INTEGER REFERENCES layouts(id) ON DELETE SET NULL;
   ALTER TABLE tournaments ADD COLUMN screen TEXT NOT NULL DEFAULT '{}';`,
  `CREATE TABLE templates (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE COLLATE NOCASE,
     config TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );`,
  `ALTER TABLE tournaments ADD COLUMN starts_at TEXT;
   ALTER TABLE tournaments ADD COLUMN prize_pool INTEGER;
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // When a tournament finished, kept by the database itself so every way of finishing it
  // (last bust, a deal, the levels running out) records the time; reopening clears it.
  `ALTER TABLE tournaments ADD COLUMN finished_at TEXT;
   UPDATE tournaments SET finished_at = COALESCE(
     (SELECT MAX(created_at) FROM action_log WHERE tournament_id = tournaments.id), created_at)
   WHERE status = 'finished';
   CREATE TRIGGER tournaments_finished_at AFTER UPDATE OF status ON tournaments
   WHEN NEW.status IS NOT OLD.status
   BEGIN
     UPDATE tournaments
     SET finished_at = CASE WHEN NEW.status = 'finished' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END
     WHERE id = NEW.id;
   END;`,
];

/** How each patchable field is stored: column name and conversion to a SQLite value. */
type Column = [string, (v: never) => string | number | null];
const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
const tournamentColumns: Record<keyof TournamentPatch, Column> = {
  name: ['name', (v: string) => v],
  buyIn: ['buy_in', (v: number) => v],
  fee: ['fee', (v: number) => v],
  startingStack: ['starting_stack', (v: number) => v],
  theme: ['theme', (v: string) => v],
  tables: ['tables', json],
  handForHand: ['hand_for_hand', (v: boolean) => (v ? 1 : 0)],
  money: ['money', json],
  payouts: ['payouts', json],
  startsAt: ['starts_at', (v: string | null) => v],
  prizePoolOverride: ['prize_pool', (v: number | null) => v],
  status: ['status', (v: string) => v],
  layoutId: ['layout_id', (v: number | null) => v],
  screen: ['screen', json],
};
const entryColumns: Record<keyof EntryPatch, Column> = {
  table: ['table_no', (v: number | null) => v],
  seat: ['seat_no', (v: number | null) => v],
  bustSeq: ['bust_seq', (v: number | null) => v],
  rebuys: ['rebuys', (v: number) => v],
  addOn: ['add_on', (v: boolean) => (v ? 1 : 0)],
  paidOut: ['paid_out', (v: number) => v],
};

const userColumns: Record<keyof UserPatch, Column> = {
  displayName: ['display_name', (v: string) => v.trim()],
  role: ['role', (v: string) => v],
  active: ['active', (v: boolean) => (v ? 1 : 0)],
  passwordHash: ['password_hash', (v: string) => v],
};

/** Builds "a = ?, b = ?" and the values for the fields present in a patch. */
function setClause<P extends object>(patch: P, columns: Record<keyof P, Column>) {
  const keys = (Object.keys(patch) as (keyof P)[]).filter((k) => k in columns && patch[k] !== undefined);
  return {
    sql: keys.map((k) => `${columns[k][0]} = ?`).join(', '),
    values: keys.map((k) => columns[k][1](patch[k] as never)),
  };
}

const toPlayer = (r: Row): Player => ({
  id: Number(r.id),
  name: String(r.name),
  fullName: (r.full_name as string | null) ?? null,
  email: (r.email as string | null) ?? null,
  phone: (r.phone as string | null) ?? null,
  createdAt: String(r.created_at),
});

const toStructure = (r: Row): BlindStructure => ({
  id: Number(r.id),
  name: String(r.name),
  levels: JSON.parse(String(r.levels)),
});

const toTournament = (r: Row): Tournament => ({
  id: Number(r.id),
  name: String(r.name),
  status: r.status as TournamentStatus,
  buyIn: Number(r.buy_in),
  fee: Number(r.fee),
  startingStack: Number(r.starting_stack),
  levels: JSON.parse(String(r.levels)),
  clock: JSON.parse(String(r.clock)),
  theme: String(r.theme),
  tables: JSON.parse(String(r.tables)),
  handForHand: Boolean(r.hand_for_hand),
  money: normalizeMoney(JSON.parse(String(r.money))),
  payouts: r.payouts == null ? null : JSON.parse(String(r.payouts)),
  layoutId: r.layout_id == null ? null : Number(r.layout_id),
  screen: { ...defaultScreen, ...JSON.parse(String(r.screen)) },
  startsAt: r.starts_at == null ? null : String(r.starts_at),
  prizePoolOverride: r.prize_pool == null ? null : Number(r.prize_pool),
  finishedAt: r.finished_at == null ? null : String(r.finished_at),
  createdAt: String(r.created_at),
});

const toUser = (r: Row): User => ({
  id: Number(r.id),
  username: String(r.username),
  displayName: String(r.display_name),
  role: String(r.role) as Role,
  active: Boolean(r.active),
  createdAt: String(r.created_at),
});

const toLayout = (r: Row): ScreenLayout => ({
  ...(JSON.parse(String(r.config)) as LayoutConfig),
  id: Number(r.id),
  name: String(r.name),
  updatedAt: String(r.updated_at),
});

const toTemplate = (r: Row): TournamentTemplate => {
  const c = JSON.parse(String(r.config)) as TemplateConfig;
  return { ...c, money: normalizeMoney(c.money), id: Number(r.id), name: String(r.name), updatedAt: String(r.updated_at) };
};

const toAsset = (r: Row): Asset => ({
  id: Number(r.id),
  name: String(r.name),
  mime: String(r.mime),
  size: Number(r.size),
  createdAt: String(r.created_at),
});

const toEntry = (r: Row): Entry => ({
  id: Number(r.id),
  tournamentId: Number(r.tournament_id),
  playerId: Number(r.player_id),
  playerName: String(r.player_name),
  table: r.table_no == null ? null : Number(r.table_no),
  seat: r.seat_no == null ? null : Number(r.seat_no),
  bustSeq: r.bust_seq == null ? null : Number(r.bust_seq),
  rebuys: Number(r.rebuys),
  addOn: Boolean(r.add_on),
  paidOut: Number(r.paid_out),
  createdAt: String(r.created_at),
});

const toAction = (r: Row): ActionLogEntry => ({
  id: Number(r.id),
  tournamentId: r.tournament_id == null ? null : Number(r.tournament_id),
  type: String(r.type),
  payload: JSON.parse(String(r.payload)),
  actor: String(r.actor),
  createdAt: String(r.created_at),
});

const blankToNull = (v: string | null | undefined) => (v == null || v.trim() === '' ? null : v.trim());

export class SqliteStorage implements Storage {
  private db!: DatabaseSync;

  /** `file` is a path on disk, or ':memory:' for tests. */
  constructor(private readonly file: string) {}

  async init() {
    if (this.file !== ':memory:') mkdirSync(dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    // FULL makes every saved action survive a power cut, not just a crash of the program.
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as Row;
    const current = row.v == null ? 0 : Number(row.v);
    for (let v = current; v < migrations.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(migrations[v]);
        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v + 1);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  async close() {
    this.db.close();
  }

  async getMeta(key: string) {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r.value) : null;
  }

  async setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  async backupTo(file: string) {
    // A consistent copy even while the server is writing; the file must not exist yet.
    this.db.prepare('VACUUM INTO ?').run(file);
  }

  private inTransaction = false;

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn();
    this.inTransaction = true;
    this.db.exec('BEGIN');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  async listPlayers(search?: string) {
    const q = search?.trim();
    const rows = q
      ? this.db
          .prepare(
            `SELECT * FROM players WHERE name LIKE ? OR full_name LIKE ? OR email LIKE ? OR phone LIKE ?
             ORDER BY name COLLATE NOCASE`,
          )
          .all(...Array(4).fill(`%${q}%`))
      : this.db.prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE').all();
    return (rows as Row[]).map(toPlayer);
  }

  async getPlayer(id: Id) {
    const r = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Row | undefined;
    return r ? toPlayer(r) : null;
  }

  async createPlayer(p: NewPlayer) {
    const r = this.db
      .prepare('INSERT INTO players (name, full_name, email, phone) VALUES (?, ?, ?, ?) RETURNING *')
      .get(p.name.trim(), blankToNull(p.fullName), blankToNull(p.email), blankToNull(p.phone)) as Row;
    return toPlayer(r);
  }

  async updatePlayer(id: Id, p: Partial<NewPlayer>) {
    const existing = await this.getPlayer(id);
    if (!existing) return null;
    const pick = <K extends keyof NewPlayer>(k: K) => (k in p ? blankToNull(p[k] as string | null) : existing[k]);
    const name = p.name?.trim() || existing.name;
    const r = this.db
      .prepare('UPDATE players SET name = ?, full_name = ?, email = ?, phone = ? WHERE id = ? RETURNING *')
      .get(name, pick('fullName'), pick('email'), pick('phone'), id) as Row;
    return toPlayer(r);
  }

  async listStructures() {
    return (this.db.prepare('SELECT * FROM blind_structures ORDER BY id').all() as Row[]).map(toStructure);
  }

  async createStructure(s: NewBlindStructure) {
    const r = this.db
      .prepare('INSERT INTO blind_structures (name, levels) VALUES (?, ?) RETURNING *')
      .get(s.name, JSON.stringify(s.levels)) as Row;
    return toStructure(r);
  }

  async listTournaments() {
    return (this.db.prepare('SELECT * FROM tournaments ORDER BY id DESC').all() as Row[]).map(toTournament);
  }

  async getTournament(id: Id) {
    const r = this.db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as Row | undefined;
    return r ? toTournament(r) : null;
  }

  async createTournament(t: NewTournament, clock: ClockState) {
    const r = this.db
      .prepare(
        `INSERT INTO tournaments (name, buy_in, fee, starting_stack, levels, clock, theme, tables, money, payouts, layout_id, starts_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        t.name,
        t.buyIn,
        t.fee,
        t.startingStack,
        JSON.stringify(t.levels),
        JSON.stringify(clock),
        t.theme ?? 'classic',
        JSON.stringify(t.tables ?? []),
        JSON.stringify(normalizeMoney(t.money)),
        t.payouts ? JSON.stringify(t.payouts) : null,
        t.layoutId ?? null,
        t.startsAt ?? null,
      ) as Row;
    return toTournament(r);
  }

  async updateTournamentClock(id: Id, clock: ClockState, status: TournamentStatus) {
    this.db.prepare('UPDATE tournaments SET clock = ?, status = ? WHERE id = ?').run(JSON.stringify(clock), status, id);
  }

  async updateTournamentLevels(id: Id, levels: Level[], clock: ClockState) {
    this.db.prepare('UPDATE tournaments SET levels = ?, clock = ? WHERE id = ?').run(JSON.stringify(levels), JSON.stringify(clock), id);
  }

  async deleteTournament(id: Id) {
    this.db.prepare('DELETE FROM entries WHERE tournament_id = ?').run(id);
    this.db.prepare('DELETE FROM action_log WHERE tournament_id = ?').run(id);
    this.db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
  }

  async updateTournament(id: Id, patch: TournamentPatch) {
    const { sql, values } = setClause(patch, tournamentColumns);
    if (sql) this.db.prepare(`UPDATE tournaments SET ${sql} WHERE id = ?`).run(...values, id);
  }

  async listEntries(tournamentId: Id) {
    const rows = this.db
      .prepare(
        `SELECT e.*, p.name AS player_name FROM entries e JOIN players p ON p.id = e.player_id
         WHERE e.tournament_id = ? ORDER BY e.id`,
      )
      .all(tournamentId) as Row[];
    return rows.map(toEntry);
  }

  async createEntry(tournamentId: Id, playerId: Id, seat: { table: number; seat: number }) {
    const { id } = this.db
      .prepare('INSERT INTO entries (tournament_id, player_id, table_no, seat_no) VALUES (?, ?, ?, ?) RETURNING id')
      .get(tournamentId, playerId, seat.table, seat.seat) as Row;
    const r = this.db
      .prepare('SELECT e.*, p.name AS player_name FROM entries e JOIN players p ON p.id = e.player_id WHERE e.id = ?')
      .get(Number(id)) as Row;
    return toEntry(r);
  }

  async updateEntry(id: Id, patch: EntryPatch) {
    const { sql, values } = setClause(patch, entryColumns);
    if (sql) this.db.prepare(`UPDATE entries SET ${sql} WHERE id = ?`).run(...values, id);
  }

  async appendAction(e: Omit<ActionLogEntry, 'id' | 'createdAt'>) {
    const r = this.db
      .prepare('INSERT INTO action_log (tournament_id, type, payload, actor) VALUES (?, ?, ?, ?) RETURNING *')
      .get(e.tournamentId, e.type, JSON.stringify(e.payload ?? null), e.actor) as Row;
    return toAction(r);
  }

  async listActions(tournamentId: Id, opts?: { types?: string[]; limit?: number }) {
    if (!opts) {
      return (
        this.db.prepare('SELECT * FROM action_log WHERE tournament_id = ? ORDER BY id').all(tournamentId) as Row[]
      ).map(toAction);
    }
    const types = opts.types ?? [];
    const typeFilter = types.length ? `AND type IN (${types.map(() => '?').join(', ')})` : '';
    const rows = this.db
      .prepare(`SELECT * FROM action_log WHERE tournament_id = ? ${typeFilter} ORDER BY id DESC LIMIT ?`)
      .all(tournamentId, ...types, opts.limit ?? -1) as Row[];
    return rows.map(toAction);
  }

  async countUsers() {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n);
  }

  async listUsers() {
    return (this.db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as Row[]).map(toUser);
  }

  async getUser(id: Id) {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return r ? toUser(r) : null;
  }

  async getLogin(username: string) {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as Row | undefined;
    return r ? { user: toUser(r), passwordHash: String(r.password_hash) } : null;
  }

  async createUser(u: NewUser) {
    const r = this.db
      .prepare('INSERT INTO users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?) RETURNING *')
      .get(u.username.trim(), u.displayName.trim(), u.role, u.passwordHash) as Row;
    return toUser(r);
  }

  async updateUser(id: Id, patch: UserPatch) {
    const { sql, values } = setClause(patch, userColumns);
    if (sql) this.db.prepare(`UPDATE users SET ${sql} WHERE id = ?`).run(...values, id);
    return this.getUser(id);
  }

  async createSession(tokenHash: string, userId: Id, expiresAt: number) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt);
  }

  async getSession(tokenHash: string) {
    const r = this.db
      .prepare(
        `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .get(tokenHash, Date.now()) as Row | undefined;
    return r ? { user: toUser(r), expiresAt: Number(r.expires_at) } : null;
  }

  async extendSession(tokenHash: string, expiresAt: number) {
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash);
  }

  async deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  async deleteUserSessions(userId: Id) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  async listLayouts() {
    return (this.db.prepare('SELECT * FROM layouts ORDER BY name COLLATE NOCASE').all() as Row[]).map(toLayout);
  }

  async getLayout(id: Id) {
    const r = this.db.prepare('SELECT * FROM layouts WHERE id = ?').get(id) as Row | undefined;
    return r ? toLayout(r) : null;
  }

  async createLayout(name: string, config: LayoutConfig) {
    const r = this.db
      .prepare('INSERT INTO layouts (name, config) VALUES (?, ?) RETURNING *')
      .get(name.trim(), JSON.stringify(config)) as Row;
    return toLayout(r);
  }

  async updateLayout(id: Id, name: string, config: LayoutConfig) {
    const r = this.db
      .prepare(
        `UPDATE layouts SET name = ?, config = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? RETURNING *`,
      )
      .get(name.trim(), JSON.stringify(config), id) as Row | undefined;
    return r ? toLayout(r) : null;
  }

  async deleteLayout(id: Id) {
    this.db.prepare('UPDATE tournaments SET layout_id = NULL WHERE layout_id = ?').run(id);
    this.db.prepare('DELETE FROM layouts WHERE id = ?').run(id);
  }

  async listTemplates() {
    return (this.db.prepare('SELECT * FROM templates ORDER BY name COLLATE NOCASE').all() as Row[]).map(toTemplate);
  }

  async getTemplate(id: Id) {
    const r = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Row | undefined;
    return r ? toTemplate(r) : null;
  }

  async saveTemplate(name: string, config: TemplateConfig) {
    const r = this.db
      .prepare(
        `INSERT INTO templates (name, config) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET config = excluded.config, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         RETURNING *`,
      )
      .get(name.trim(), JSON.stringify(config)) as Row;
    return toTemplate(r);
  }

  async deleteTemplate(id: Id) {
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  }

  async listAssets() {
    return (
      this.db.prepare('SELECT id, name, mime, length(data) AS size, created_at FROM assets ORDER BY id DESC').all() as Row[]
    ).map(toAsset);
  }

  async createAsset(name: string, mime: string, data: Uint8Array) {
    const r = this.db
      .prepare('INSERT INTO assets (name, mime, data) VALUES (?, ?, ?) RETURNING id, name, mime, length(data) AS size, created_at')
      .get(name, mime, data) as Row;
    return toAsset(r);
  }

  async getAssetData(id: Id) {
    const r = this.db.prepare('SELECT *, length(data) AS size FROM assets WHERE id = ?').get(id) as Row | undefined;
    return r ? { asset: toAsset(r), data: r.data as Uint8Array } : null;
  }
}
