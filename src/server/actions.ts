import type { FastifyReply } from 'fastify';
import type { Storage } from './storage/storage.js';
import type { Entry, Id, Tournament } from '../shared/types.js';

/** Thrown inside an action to answer the request with a 4xx and a readable message. */
export class ActionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ActionContext {
  t: Tournament;
  entries: Entry[];
  entry(id: string | number): Entry;
}

export type RunAction = <T>(
  reply: FastifyReply,
  tournamentId: Id,
  type: string,
  actor: string,
  fn: (ctx: ActionContext) => Promise<{ result: T; payload: unknown }>,
) => Promise<unknown>;

/**
 * Runs tournament changes one at a time per tournament, each in a
 * transaction, writes them to the action log and pushes the new state to
 * every screen watching the tournament.
 */
export function createActionRunner(storage: Storage, publish: (id: Id) => Promise<void>): RunAction {
  const locks = new Map<Id, Promise<unknown>>();

  return async (reply, tournamentId, type, actor, fn) => {
    const previous = locks.get(tournamentId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() =>
      storage.transaction(async () => {
        const t = await storage.getTournament(tournamentId);
        if (!t) throw new ActionError('tournament not found', 404);
        const entries = await storage.listEntries(tournamentId);
        const entry = (id: string | number) => {
          const e = entries.find((x) => x.id === Number(id));
          if (!e) throw new ActionError('entry not found', 404);
          return e;
        };
        const { result, payload } = await fn({ t, entries, entry });
        await storage.appendAction({ tournamentId, type, payload, actor });
        return result;
      }),
    );
    locks.set(tournamentId, task);
    try {
      const result = await task;
      await publish(tournamentId);
      return result;
    } catch (err) {
      if (err instanceof ActionError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  };
}
