import type { WebSocket } from 'ws';
import type { Entry, Id, ServerMessage, Tournament } from '../shared/types.js';

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

  publish(tournament: Tournament, entries: Entry[]) {
    for (const s of this.watchers.get(tournament.id) ?? []) {
      this.send(s, { type: 'tournament', tournament, entries, serverTime: Date.now() });
    }
  }
}
