import type { FastifyInstance } from 'fastify';
import type { Storage } from './storage/storage.js';
import { ActionError, type RunAction } from './actions.js';
import { cleanLayout, defaultLayout, layoutError, type LayoutConfig } from '../shared/layout.js';
import type { ActionLogEntry, Entry, Id, Move, Scene, ScreenState } from '../shared/types.js';

const scenes: Scene[] = ['clock', 'seating', 'moves', 'payouts', 'message'];
const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_IMAGE = 5 * 1024 * 1024;
export const MOVE_TYPES = ['entry.move', 'table.balance', 'table.break', 'table.redraw'];

/** The layout a tournament's screens use: its saved layout, or the built-in one. */
export async function layoutFor(storage: Storage, layoutId: Id | null): Promise<LayoutConfig> {
  const saved = layoutId ? await storage.getLayout(layoutId) : null;
  if (!saved) return defaultLayout;
  const { id: _id, name: _name, updatedAt: _u, ...config } = saved;
  return config;
}

/** Player moves from the action log, newest first, limited to the last half hour. */
export function movesFrom(actions: ActionLogEntry[], entries: Entry[], now = Date.now()): Move[] {
  const names = new Map(entries.map((e) => [e.id, e.playerName]));
  const moves: Move[] = [];
  for (const a of actions) {
    if (now - Date.parse(a.createdAt) > 30 * 60_000) break;
    const p = a.payload as Record<string, any>;
    const name = (id: number) => names.get(id) ?? '?';
    if (a.type === 'entry.move') {
      moves.push({ at: a.createdAt, playerName: name(p.entryId), from: p.from, to: p.to, reason: 'balance' });
    } else if (a.type === 'table.balance') {
      for (const m of p.moves ?? []) moves.push({ at: a.createdAt, playerName: name(m.entryId), from: m.from, to: m.to, reason: 'balance' });
    } else if (a.type === 'table.break') {
      for (const m of p.moves ?? []) {
        moves.push({ at: a.createdAt, playerName: name(m.entryId), from: { table: p.table, seat: null }, to: m.to, reason: 'break' });
      }
    } else if (a.type === 'table.redraw') {
      for (const s of p.seats ?? []) {
        moves.push({
          at: a.createdAt,
          playerName: name(s.entryId),
          from: null,
          to: { table: p.table, seat: s.seat },
          reason: 'redraw',
        });
      }
    }
    if (moves.length >= 60) break;
  }
  return moves;
}

/** Saved layouts, uploaded images and what the big screens show. */
export function registerScreenRoutes(app: FastifyInstance, storage: Storage, run: RunAction, publishAll: () => Promise<void>) {
  app.get('/api/layouts', async () => storage.listLayouts());

  const readLayout = (body: unknown) => {
    const b = (body ?? {}) as { name?: string; layout?: LayoutConfig };
    if (!b.name?.trim()) throw new ActionError('give the layout a name');
    const problem = layoutError(b.layout);
    if (problem) throw new ActionError(problem);
    return { name: b.name.trim().slice(0, 80), config: cleanLayout(b.layout!) };
  };

  app.post('/api/layouts', async (req, reply) => {
    try {
      const { name, config } = readLayout(req.body);
      return reply.code(201).send(await storage.createLayout(name, config));
    } catch (err) {
      if (err instanceof ActionError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.put<{ Params: { id: string } }>('/api/layouts/:id', async (req, reply) => {
    try {
      const { name, config } = readLayout(req.body);
      const layout = await storage.updateLayout(Number(req.params.id), name, config);
      if (!layout) return reply.code(404).send({ error: 'layout not found' });
      await publishAll();
      return layout;
    } catch (err) {
      if (err instanceof ActionError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/layouts/:id', async (req) => {
    await storage.deleteLayout(Number(req.params.id));
    await publishAll();
    return { ok: true };
  });

  // Images are sent as the raw request body, with the file name in the query string.
  for (const type of imageTypes) {
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_IMAGE }, (_req, body, done) => done(null, body));
  }

  app.get('/api/assets', async () => storage.listAssets());

  app.post<{ Querystring: { name?: string } }>('/api/assets', async (req, reply) => {
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    if (!imageTypes.includes(mime) || !Buffer.isBuffer(req.body)) {
      return reply.code(400).send({ error: 'upload a PNG, JPEG, GIF, WebP or SVG image' });
    }
    const name = (req.query.name ?? 'image').slice(0, 120);
    return reply.code(201).send(await storage.createAsset(name, mime, req.body));
  });

  app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const found = await storage.getAssetData(Number(req.params.id));
    if (!found) return reply.code(404).send({ error: 'image not found' });
    return reply
      .header('Content-Type', found.asset.mime)
      .header('Cache-Control', 'public, max-age=86400')
      // An SVG can carry scripts; this stops them running when the image is opened directly.
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
      .send(Buffer.from(found.data));
  });

  app.post<{ Params: { id: string }; Body: { scene?: string; message?: string; seconds?: number; autoMoves?: boolean } }>(
    '/api/tournaments/:id/screen',
    (req, reply) =>
      run(reply, Number(req.params.id), 'screen.set', 'director', async ({ t }) => {
        const b = req.body ?? {};
        const screen: ScreenState = { ...t.screen };
        if (b.scene !== undefined) {
          if (!scenes.includes(b.scene as Scene)) throw new ActionError('unknown screen');
          screen.scene = b.scene as Scene;
          const seconds = Number(b.seconds ?? 0);
          screen.until = b.scene !== 'clock' && seconds > 0 ? Date.now() + Math.min(seconds, 3600) * 1000 : null;
        }
        if (b.message !== undefined) screen.message = String(b.message).slice(0, 300);
        if (b.autoMoves !== undefined) screen.autoMoves = Boolean(b.autoMoves);
        await storage.updateTournament(t.id, { screen });
        return { result: screen, payload: screen };
      }),
  );
}
