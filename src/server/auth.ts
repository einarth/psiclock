import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Storage } from './storage/storage.js';
import { hasRole, isRole, type Role, type User } from '../shared/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'psiclock_session';
const SESSION_DAYS = 14;
const MIN_PASSWORD = 8;

/** Passwords are stored as "scrypt$<salt>$<hash>", both base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function readCookie(req: FastifyRequest, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Starts a session and returns the cookie header that carries it. */
export async function startSession(storage: Storage, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await storage.createSession(tokenHash(token), userId, Date.now() + SESSION_DAYS * 86_400_000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/**
 * Who may call what. Anything under /api that is not listed is admin-only,
 * so a new route stays locked until someone decides who should use it.
 * Pages, the WebSocket and the screens' read-only data are open to everyone.
 */
const access: Record<string, Role | 'public' | 'signedIn'> = {
  'GET /api/time': 'public',
  'GET /api/auth/me': 'public',
  'POST /api/auth/setup': 'public',
  'POST /api/auth/login': 'public',
  'POST /api/auth/logout': 'public',
  'POST /api/auth/password': 'signedIn',
  'GET /api/structures': 'public',
  'GET /api/tournaments': 'public',
  'GET /api/tournaments/:id': 'public',
  'GET /api/tournaments/:id/entries': 'public',
  'GET /api/assets/:id': 'public',
  'GET /ws': 'public',

  'POST /api/tournaments/:id/entries/:entryId/bust': 'floor',
  'POST /api/tournaments/:id/entries/:entryId/restore': 'floor',
  'POST /api/tournaments/:id/entries/:entryId/move': 'floor',
  'POST /api/tournaments/:id/tables': 'floor',
  'POST /api/tournaments/:id/tables/:table/break': 'floor',
  'POST /api/tournaments/:id/tables/:table/redraw': 'floor',
  'POST /api/tournaments/:id/hand-for-hand': 'floor',
  'POST /api/tournaments/:id/clock/run': 'floor',

  'GET /api/players': 'desk',
  'GET /api/players/:id': 'desk',
  'POST /api/players': 'desk',
  'PATCH /api/players/:id': 'desk',
  'POST /api/tournaments/:id/entries': 'desk',
  'POST /api/tournaments/:id/entries/:entryId/rebuy': 'desk',
  'POST /api/tournaments/:id/entries/:entryId/rebuy/undo': 'desk',
  'POST /api/tournaments/:id/entries/:entryId/add-on': 'desk',
  'POST /api/tournaments/:id/entries/:entryId/paid': 'desk',
  'GET /api/tournaments/:id/results.csv': 'desk',

  'POST /api/structures': 'director',
  'POST /api/tournaments': 'director',
  'PATCH /api/tournaments/:id': 'director',
  'POST /api/tournaments/:id/clock': 'director',
  'PUT /api/tournaments/:id/levels': 'director',
  'POST /api/tournaments/:id/screen': 'director',
  'GET /api/tournaments/:id/actions': 'director',
  'GET /api/templates': 'director',
  'POST /api/templates': 'director',
  'DELETE /api/templates/:id': 'director',
  'GET /api/layouts': 'director',
  'POST /api/layouts': 'director',
  'PUT /api/layouts/:id': 'director',
  'DELETE /api/layouts/:id': 'director',
  'GET /api/assets': 'director',
  'POST /api/assets': 'director',
};

const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/** Logins, sessions, the access rules for every route, and user management. */
export function registerAuth(app: FastifyInstance, storage: Storage) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const hash = tokenHash(token);
      const session = await storage.getSession(hash);
      req.user = session?.user ?? null;
      // Keep active sessions alive; refresh at most once a day.
      if (session && session.expiresAt - Date.now() < (SESSION_DAYS - 1) * 86_400_000) {
        await storage.extendSession(hash, Date.now() + SESSION_DAYS * 86_400_000);
      }
    }
    const url = req.routeOptions.url;
    if (!url || !url.startsWith('/api')) return;
    const rule = access[`${req.method} ${url}`] ?? 'admin';
    if (rule === 'public') return;
    if (!req.user) return reply.code(401).send({ error: 'please sign in' });
    if (rule !== 'signedIn' && !hasRole(req.user, rule)) {
      return reply.code(403).send({ error: `this needs a ${rule} login` });
    }
  });

  // Slows down password guessing: 10 failed logins per address, then a 10 minute wait.
  const failures = new Map<string, { count: number; until: number }>();
  const tooMany = (ip: string) => {
    const f = failures.get(ip);
    return !!f && f.count >= 10 && f.until > Date.now();
  };
  const failed = (ip: string) => {
    const f = failures.get(ip);
    const fresh = !f || f.until < Date.now();
    failures.set(ip, { count: fresh ? 1 : f!.count + 1, until: Date.now() + 600_000 });
  };

  app.get('/api/auth/me', async (req) => ({
    user: req.user,
    setupNeeded: (await storage.countUsers()) === 0,
    setupAllowed: isLoopback(req.ip),
  }));

  // The very first login is made on the laptop running the server and becomes the admin.
  app.post<{ Body: { username?: string; displayName?: string; password?: string } }>(
    '/api/auth/setup',
    async (req, reply) => {
      if ((await storage.countUsers()) > 0) return reply.code(409).send({ error: 'already set up; please sign in' });
      if (!isLoopback(req.ip)) {
        return reply.code(403).send({ error: 'create the first login on the laptop running PSICLOCK' });
      }
      const problem = userProblem(req.body ?? {}, true);
      if (problem) return reply.code(400).send({ error: problem });
      const b = req.body!;
      const user = await storage.createUser({
        username: b.username!,
        displayName: b.displayName?.trim() || b.username!,
        role: 'admin',
        passwordHash: await hashPassword(b.password!),
      });
      await storage.appendAction({ tournamentId: null, type: 'user.create', payload: user, actor: user.username });
      return reply.header('Set-Cookie', await startSession(storage, user.id)).code(201).send({ user });
    },
  );

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    if (tooMany(req.ip)) return reply.code(429).send({ error: 'too many failed logins; wait 10 minutes' });
    const login = await storage.getLogin(String(req.body?.username ?? ''));
    const ok =
      login && login.user.active && (await verifyPassword(String(req.body?.password ?? ''), login.passwordHash));
    if (!ok) {
      failed(req.ip);
      return reply.code(401).send({ error: 'wrong username or password' });
    }
    failures.delete(req.ip);
    return reply.header('Set-Cookie', await startSession(storage, login.user.id)).send({ user: login.user });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await storage.deleteSession(tokenHash(token));
    return reply.header('Set-Cookie', clearCookie).send({ ok: true });
  });

  app.post<{ Body: { current?: string; password?: string } }>('/api/auth/password', async (req, reply) => {
    const login = await storage.getLogin(req.user!.username);
    if (!login || !(await verifyPassword(String(req.body?.current ?? ''), login.passwordHash))) {
      return reply.code(400).send({ error: 'your current password is wrong' });
    }
    const problem = passwordProblem(req.body?.password);
    if (problem) return reply.code(400).send({ error: problem });
    await storage.updateUser(login.user.id, { passwordHash: await hashPassword(req.body!.password!) });
    // Sign out everywhere else, then start a fresh session here.
    await storage.deleteUserSessions(login.user.id);
    return reply.header('Set-Cookie', await startSession(storage, login.user.id)).send({ ok: true });
  });

  app.get('/api/users', async () => storage.listUsers());

  app.post<{ Body: { username?: string; displayName?: string; role?: string; password?: string } }>(
    '/api/users',
    async (req, reply) => {
      const b = req.body ?? {};
      const problem = userProblem(b, true) ?? (isRole(b.role) ? null : 'pick a role');
      if (problem) return reply.code(400).send({ error: problem });
      if (await storage.getLogin(b.username!)) return reply.code(409).send({ error: `${b.username} is already taken` });
      const user = await storage.createUser({
        username: b.username!,
        displayName: b.displayName?.trim() || b.username!,
        role: b.role as Role,
        passwordHash: await hashPassword(b.password!),
      });
      await storage.appendAction({ tournamentId: null, type: 'user.create', payload: user, actor: req.user!.username });
      return reply.code(201).send(user);
    },
  );

  app.patch<{ Params: { id: string }; Body: { displayName?: string; role?: string; active?: boolean; password?: string } }>(
    '/api/users/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      const user = await storage.getUser(id);
      if (!user) return reply.code(404).send({ error: 'user not found' });
      const b = req.body ?? {};
      if (b.role !== undefined && !isRole(b.role)) return reply.code(400).send({ error: 'pick a role' });
      if (b.displayName !== undefined && !b.displayName.trim()) return reply.code(400).send({ error: 'name cannot be blank' });
      if (b.password !== undefined) {
        const problem = passwordProblem(b.password);
        if (problem) return reply.code(400).send({ error: problem });
      }
      const losesAdmin = user.role === 'admin' && user.active && (b.active === false || (b.role && b.role !== 'admin'));
      if (losesAdmin) {
        const admins = (await storage.listUsers()).filter((u) => u.role === 'admin' && u.active);
        if (admins.length === 1) return reply.code(400).send({ error: 'keep at least one active admin' });
      }
      const updated = await storage.updateUser(id, {
        displayName: b.displayName,
        role: b.role as Role | undefined,
        active: b.active,
        passwordHash: b.password !== undefined ? await hashPassword(b.password) : undefined,
      });
      // A new password, a lower role or a disabled login signs the user out everywhere.
      if (b.password !== undefined || b.active === false || b.role !== undefined) await storage.deleteUserSessions(id);
      const { password: _, ...logged } = b;
      await storage.appendAction({
        tournamentId: null,
        type: 'user.update',
        payload: { id, ...logged, passwordChanged: b.password !== undefined },
        actor: req.user!.username,
      });
      return updated;
    },
  );
}

function passwordProblem(p: unknown): string | null {
  return typeof p === 'string' && p.length >= MIN_PASSWORD ? null : `passwords need at least ${MIN_PASSWORD} characters`;
}

function userProblem(b: { username?: string; password?: string }, needPassword: boolean): string | null {
  const name = b.username?.trim() ?? '';
  if (!/^[\p{L}\p{N}._-]{2,40}$/u.test(name)) return 'usernames are 2 to 40 letters, digits, dots, dashes or underscores';
  return needPassword ? passwordProblem(b.password) : null;
}

/** The signed-in user's name for the action log, or the role that did it when nobody is signed in. */
export const actorOf = (req: FastifyRequest, fallback: string) => req.user?.username ?? fallback;

