import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Storage } from './storage.js';
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
import { defaultMoney } from '../../shared/money.js';

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
};
const entryColumns: Record<keyof EntryPatch, Column> = {
  table: ['table_no', (v: number | null) => v],
  seat: ['seat_no', (v: number | null) => v],
  bustSeq: ['bust_seq', (v: number | null) => v],
  rebuys: ['rebuys', (v: number) => v],
  addOn: ['add_on', (v: boolean) => (v ? 1 : 0)],
  paidOut: ['paid_out', (v: number) => v],
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
  money: { ...defaultMoney, ...JSON.parse(String(r.money)) },
  payouts: r.payouts == null ? null : JSON.parse(String(r.payouts)),
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
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
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
        `INSERT INTO tournaments (name, buy_in, fee, starting_stack, levels, clock, theme, tables, money)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
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
        JSON.stringify({ ...defaultMoney, ...t.money }),
      ) as Row;
    return toTournament(r);
  }

  async updateTournamentClock(id: Id, clock: ClockState, status: TournamentStatus) {
    this.db.prepare('UPDATE tournaments SET clock = ?, status = ? WHERE id = ?').run(JSON.stringify(clock), status, id);
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

  async listActions(tournamentId: Id) {
    return (
      this.db.prepare('SELECT * FROM action_log WHERE tournament_id = ? ORDER BY id').all(tournamentId) as Row[]
    ).map(toAction);
  }
}
