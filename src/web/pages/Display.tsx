import { useEffect, useRef, useState } from 'react';
import { useClockView, useLiveTournament } from '../live';
import { formatClock } from '../../shared/clock';
import { blindsText, num } from '../format';

/** Short two-tone chime played on the big screen when a level changes. */
function chime(ctx: AudioContext) {
  [880, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.35 + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.35);
    osc.stop(ctx.currentTime + i * 0.35 + 0.3);
  });
}

export function Display({ id }: { id: number }) {
  const { tournament: t, offset, connected } = useLiveTournament(id);
  const view = useClockView(t, offset);
  const audio = useRef<AudioContext | null>(null);
  const lastLevel = useRef<number | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const theme = new URLSearchParams(location.search).get('theme') ?? t?.theme ?? 'classic';

  useEffect(() => {
    if (!view) return;
    if (lastLevel.current !== null && lastLevel.current !== view.levelIndex && audio.current) chime(audio.current);
    lastLevel.current = view.levelIndex;
  }, [view?.levelIndex]);

  // Browsers only allow sound after a click, which also puts the screen in full screen.
  const enable = () => {
    audio.current ??= new AudioContext();
    setSoundOn(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (!t || !view) return <div className="display" data-theme={theme}>Connecting...</div>;
  const isBreak = view.level?.kind === 'break';
  const lowTime = view.running && view.remainingMs < 60_000;

  return (
    <div className="display" data-theme={theme} onClick={enable}>
      <header className="display-title">{t.name}</header>
      <div className="display-level">{isBreak ? 'Break' : `Level ${view.levelNumber}`}</div>
      <div className={`display-clock${lowTime ? ' low' : ''}${view.running ? '' : ' paused'}`}>
        {formatClock(view.remainingMs)}
      </div>
      {!view.running && !view.finished && <div className="display-paused">{t.status === 'setup' ? 'Starting soon' : 'Paused'}</div>}
      <div className="display-blinds">{isBreak ? (view.level?.kind === 'break' && view.level.note) || '' : blindsText(view.level)}</div>
      <div className="display-next">Next: {view.nextLevel ? blindsText(view.nextLevel) : 'final level'}</div>
      <footer className="display-stats">
        <div>
          <span>Buy-in</span>
          {num(t.buyIn)}
          {t.fee ? ` + ${num(t.fee)}` : ''}
        </div>
        <div>
          <span>Starting stack</span>
          {num(t.startingStack)}
        </div>
      </footer>
      {!soundOn && <div className="display-hint">Click anywhere for full screen and sound</div>}
      {!connected && <div className="display-offline">Reconnecting to server...</div>}
    </div>
  );
}
