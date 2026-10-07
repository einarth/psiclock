import type { WebSocket } from 'ws';
import type { Id, ServerMessage, Tournament } from '../shared/types.js';

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

  publishTournament(t: Tournament) {
    for (const s of this.watchers.get(t.id) ?? []) {
      this.send(s, { type: 'tournament', tournament: t, serverTime: Date.now() });
    }
  }
}
