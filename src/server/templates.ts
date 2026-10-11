import type { FastifyInstance } from 'fastify';
import type { Storage } from './storage/storage.js';
import { actorOf } from './auth.js';
import type { TemplateConfig, Tournament } from '../shared/types.js';

/** The parts of a tournament that a new one can start from. */
export function templateFrom(t: Tournament): TemplateConfig {
  return {
    buyIn: t.buyIn,
    fee: t.fee,
    startingStack: t.startingStack,
    levels: t.levels,
    tableCount: t.tables.length,
    seatsPerTable: t.tables[0]?.seats ?? 9,
    money: t.money,
    payouts: t.payouts,
    layoutId: t.layoutId,
  };
}

/** Saved tournament templates: structure, money settings, payout table and screen layout. */
export function registerTemplateRoutes(app: FastifyInstance, storage: Storage) {
  app.get('/api/templates', async () => storage.listTemplates());

  app.post<{ Body: { name?: string; tournamentId?: number } }>('/api/templates', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'give the template a name' });
    if (name.length > 80) return reply.code(400).send({ error: 'the name is too long' });
    const t = await storage.getTournament(Number(req.body?.tournamentId));
    if (!t) return reply.code(404).send({ error: 'tournament not found' });
    const template = await storage.saveTemplate(name, templateFrom(t));
    await storage.appendAction({ tournamentId: t.id, type: 'template.save', payload: { id: template.id, name }, actor: actorOf(req, 'director') });
    return reply.code(201).send(template);
  });

  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
    await storage.deleteTemplate(Number(req.params.id));
    return { ok: true };
  });
}
