import type { WebSocket } from 'ws';
import type { Id, ServerMessage } from '../shared/types.js';

/** Keeps track of which sockets watch which tournament and pushes updates to them. */
export class Hub {
  private watchers = new Map<Id, Set<WebSocket>>();

  watch(tournamentId: Id, socket: WebSocket) {
    let set = this.watchers.get(tournamentId);
    if (!set) this.watchers.set(tournamentId, (set = new Set()));
    set.add(socket);
    socket.on('close', () => set.delete(socket));
  }

  send(socket: WebSocket, msg: ServerMessage) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  publish(tournamentId: Id, msg: ServerMessage) {
    for (const s of this.watchers.get(tournamentId) ?? []) this.send(s, msg);
  }

  /** Tournaments that at least one screen is watching. */
  watched(): Id[] {
    return [...this.watchers].filter(([, set]) => set.size > 0).map(([id]) => id);
  }
}
