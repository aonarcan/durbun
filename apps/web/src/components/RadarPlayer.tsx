import { useEffect } from 'react';
import { t } from '../i18n.ts';
import { clockTime, timeAgo } from '../lib/format.ts';
import { useNow } from '../lib/useNow.ts';
import { frameIndex, isVisible, useData, useRaster, useUi } from '../state.ts';

/** Play controls for the rain radar: the last two hours, one frame every ten minutes. */
export function RadarPlayer() {
  const layer = useData((s) => s.layers.find((l) => (l.raster?.frames.length ?? 0) > 1));
  const visible = useUi((s) => s.visible);
  const lang = useUi((s) => s.lang);
  const frame = useRaster((s) => s.frame);
  const playing = useRaster((s) => s.playing);
  const now = useNow(30_000);

  const on = Boolean(layer && isVisible(layer, visible));
  const frames = layer?.raster?.frames ?? [];
  const index = layer ? frameIndex(layer, frame) : 0;

  const setIndex = (i: number) => {
    if (!layer) return;
    useRaster.setState((s) => {
      const next = { ...s.frame };
      // At the newest frame, follow new frames as they arrive.
      if (i >= frames.length - 1) delete next[layer.id];
      else next[layer.id] = i;
      return { frame: next };
    });
  };

  // Step through the frames; linger a moment on the newest before starting over.
  useEffect(() => {
    if (!on || !playing || frames.length < 2) return;
    const last = index >= frames.length - 1;
    const timer = setTimeout(() => setIndex(last ? 0 : index + 1), last ? 1500 : 650);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    if (!on && playing) useRaster.setState({ playing: false });
  }, [on, playing]);

  if (!layer || !on || frames.length < 2) return null;
  const time = frames[index]?.time;

  return (
    <div className="radar-player" aria-label={t(lang, 'radarFrame')}>
      <button
        type="button"
        className="play-button"
        aria-label={t(lang, playing ? 'radarPause' : 'radarPlay')}
        onClick={() => useRaster.setState({ playing: !playing })}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        step={1}
        value={index}
        aria-label={t(lang, 'radarFrame')}
        onChange={(e) => {
          useRaster.setState({ playing: false });
          setIndex(Number(e.target.value));
        }}
      />
      <span className="radar-time">
        <strong>{clockTime(time, lang)}</strong> <span className="muted">{timeAgo(time, lang, now)}</span>
      </span>
    </div>
  );
}
