import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Storage } from './storage.js';
import type {
  ActionLogEntry,
  BlindStructure,
  ClockState,
  Id,
  NewBlindStructure,
  NewPlayer,
  NewTournament,
  Player,
  Tournament,
  TournamentStatus,
} from '../../shared/types.js';

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
];

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
        `INSERT INTO tournaments (name, buy_in, fee, starting_stack, levels, clock, theme)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        t.name,
        t.buyIn,
        t.fee,
        t.startingStack,
        JSON.stringify(t.levels),
        JSON.stringify(clock),
        t.theme ?? 'classic',
      ) as Row;
    return toTournament(r);
  }

  async updateTournamentClock(id: Id, clock: ClockState, status: TournamentStatus) {
    this.db.prepare('UPDATE tournaments SET clock = ?, status = ? WHERE id = ?').run(JSON.stringify(clock), status, id);
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
