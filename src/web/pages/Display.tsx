import { useEffect, useRef, useState } from 'react';
import { useClockView, useLiveTournament, useServerNow } from '../live';
import { ScreenView, currentScene, themeStyle } from '../screen/ScreenView';

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

/**
 * The big screen. It shows whatever the director has put on the screens
 * (clock, seating, moves, payouts or a message). Add ?scene=payouts to pin
 * one TV to a scene, or ?theme=midnight to override the theme.
 */
export function Display({ id, pin }: { id: number; pin?: string }) {
  const { tournament: t, entries, layout, moves, offset, connected } = useLiveTournament(id);
  const view = useClockView(t, offset);
  const now = useServerNow(offset);
  const audio = useRef<AudioContext | null>(null);
  const lastLevel = useRef<number | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  const shownLayout = theme ? { ...layout, theme } : layout;

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

  return (
    <div className="screen-page" data-theme={shownLayout.theme} style={themeStyle(shownLayout)} onClick={enable}>
      {t && view ? (
        <ScreenView
          t={t}
          entries={entries}
          view={view}
          layout={shownLayout}
          moves={moves}
          now={now}
          scene={currentScene(t, now, pin ?? params.get('scene'))}
        />
      ) : (
        <div className="screen">
          <div className="scene-message">{connected ? 'Tournament not found' : 'Connecting...'}</div>
        </div>
      )}
      {!soundOn && <div className="display-hint">Click anywhere for full screen and sound</div>}
      {!connected && <div className="display-offline">Reconnecting to server...</div>}
    </div>
  );
}
