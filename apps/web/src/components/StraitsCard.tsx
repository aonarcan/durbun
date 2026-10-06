import type { Feature, ScheduleRow } from '@durbun/core';
import { t, type StringKey } from '../i18n.ts';
import { useNow } from '../lib/useNow.ts';
import { useData, useUi } from '../state.ts';

/** Türkiye keeps UTC+3 all year, so local clock minutes are a fixed offset from UTC. */
const TR_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** Local (İstanbul) day number and minute of day for a time. */
function local(ms: number): { day: number; minute: number } {
  const l = ms + TR_OFFSET_MS;
  return { day: Math.floor(l / DAY_MS), minute: Math.floor((l % DAY_MS) / 60_000) };
}

const STATE_KEYS: Record<string, StringKey> = {
  open: 'stateOpen',
  suspended: 'stateSuspended',
  unplanned: 'stateUnplanned',
};

/**
 * Rough anchorage areas at each end of the straits, where ships wait for
 * their turn: [west, south, east, north]. Approximate, drawn from charts.
 */
const ANCHORAGES: Record<string, { label: { tr: string; en: string }; box: [number, number, number, number] }[]> = {
  'strait:istanbul': [
    { label: { tr: 'Karadeniz girişi', en: 'Black Sea entrance' }, box: [29.0, 41.2, 29.35, 41.4] },
    { label: { tr: 'Marmara girişi (Ahırkapı)', en: 'Marmara entrance (Ahırkapı)' }, box: [28.8, 40.88, 29.1, 41.0] },
  ],
  'strait:canakkale': [
    { label: { tr: 'Marmara girişi', en: 'Marmara entrance' }, box: [26.55, 40.33, 26.95, 40.55] },
    { label: { tr: 'Ege girişi', en: 'Aegean entrance' }, box: [25.95, 39.85, 26.3, 40.08] },
  ],
};

/** One day of a direction's schedule as a bar from 00:00 to 24:00, with a "now" marker. */
function DayBar({ row, day, now }: { row: ScheduleRow; day: number; now: number }) {
  const segments = row.periods.flatMap((p) => {
    const a = local(Date.parse(p.from));
    const b = local(Date.parse(p.to));
    if (a.day !== day) return [];
    const end = b.day === day ? b.minute + 1 : 1440;
    return [{ start: a.minute, end, state: p.state }];
  });
  if (segments.length === 0) return null;
  const n = local(now);
  return (
    <div className="day-bar" role="img">
      {segments.map((s) => (
        <span
          key={s.start}
          className={`seg seg-${s.state}`}
          style={{ left: `${(s.start / 1440) * 100}%`, width: `${((s.end - s.start) / 1440) * 100}%` }}
        />
      ))}
      {n.day === day && <span className="now-mark" style={{ left: `${(n.minute / 1440) * 100}%` }} />}
    </div>
  );
}

/** The Straits card: open and suspended hours per direction, and ships waiting at each end. */
export function StraitsCard({ feature }: { feature: Feature }) {
  const lang = useUi((s) => s.lang);
  const ships = useData((s) => s.collections.ships?.features);
  const now = useNow(30_000);
  const rows = feature.properties.schedule ?? [];
  const today = local(now).day;
  const days = [today, today + 1].filter((d) =>
    rows.some((r) => r.periods.some((p) => local(Date.parse(p.from)).day === d)),
  );
  const anchorages = ANCHORAGES[feature.properties.id] ?? [];
  const waiting = anchorages.map((a) => {
    const [w, s, e, n] = a.box;
    const count = (ships ?? []).filter((f) => {
      if (f.geometry?.type !== 'Point' || f.properties.style?.moving !== 0) return false;
      const [x, y] = f.geometry.coordinates;
      return x >= w && x <= e && y >= s && y <= n;
    }).length;
    return { label: a.label[lang], count };
  });

  return (
    <section className="straits-card">
      <h3>{t(lang, 'straitSchedule')}</h3>
      {days.map((d) => (
        <div key={d} className="straits-day">
          <div className="muted small-text">{t(lang, d === today ? 'straitToday' : 'straitTomorrow')}</div>
          {rows.map((r) => (
            <div key={r.label} className="straits-row">
              <span className="straits-label">{r.label}</span>
              <DayBar row={r} day={d} now={now} />
            </div>
          ))}
        </div>
      ))}
      <div className="bar-scale muted">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <div className="legend">
        {(['open', 'suspended', 'unplanned'] as const).map((s) => (
          <span key={s}>
            <i className={`seg-${s}`} /> {t(lang, STATE_KEYS[s]!)}
          </span>
        ))}
      </div>
      <h4>{t(lang, 'shipsWaiting')}</h4>
      {ships && ships.length > 0 ? (
        <>
          <ul className="mini-list">
            {waiting.map((w) => (
              <li key={w.label}>
                {w.label}: <strong>{w.count}</strong>
              </li>
            ))}
          </ul>
          <p className="muted small-text">{t(lang, 'shipsWaitingNote')}</p>
        </>
      ) : (
        <p className="muted small-text">{t(lang, 'noShipData')}</p>
      )}
    </section>
  );
}
