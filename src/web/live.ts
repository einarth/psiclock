import { useEffect, useState } from 'react';
import { clockAt, type ClockView } from '../shared/clock';
import type { ServerMessage, Tournament } from '../shared/types';

/**
 * Subscribes to a tournament over the WebSocket and keeps a local clock view
 * ticking. The offset to the server's clock is tracked so every screen shows
 * the same time even if the device clocks disagree.
 */
export function useLiveTournament(id: number) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [offset, setOffset] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/ws?tournament=${id}`);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        setOffset(msg.serverTime - Date.now());
        if (msg.type === 'tournament') setTournament(msg.tournament);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [id]);

  return { tournament, setTournament, offset, connected };
}

export function useClockView(t: Tournament | null, offset: number): ClockView | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  return t ? clockAt(t.levels, t.clock, now + offset) : null;
}
