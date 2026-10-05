import { STATUS_LABELS, t } from '../i18n.ts';
import { duration, interval, timeAgo } from '../lib/format.ts';
import { useNow } from '../lib/useNow.ts';
import { useData, useUi } from '../state.ts';

/** Every source, its status and its last error. A source counts as done only once it shows here. */
export function SourcesPage() {
  const sources = useData((s) => s.sources);
  const layers = useData((s) => s.layers);
  const lang = useUi((s) => s.lang);
  const now = useNow(5_000);

  const counts = sources.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
  const layerName = (id: string) => layers.find((l) => l.id === id)?.name[lang] ?? id;

  return (
    <main className="sources-page">
      <h1>{t(lang, 'sourcesTitle')}</h1>
      <p className="muted">{t(lang, 'sourcesIntro')}</p>
      <p className="status-summary">
        {Object.entries(counts).map(([status, n]) => (
          <span key={status} className={`badge status-${status}`}>
            {STATUS_LABELS[status]?.[lang] ?? status}: {n}
          </span>
        ))}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t(lang, 'colSource')}</th>
              <th>{t(lang, 'colStatus')}</th>
              <th>{t(lang, 'colLastSuccess')}</th>
              <th className="num">{t(lang, 'colItems')}</th>
              <th>{t(lang, 'colNewest')}</th>
              <th className="num">{t(lang, 'colDuration')}</th>
              <th>{t(lang, 'colInterval')}</th>
              <th>{t(lang, 'colError')}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={s.homepage} target="_blank" rel="noreferrer">
                    {s.name[lang]}
                  </a>
                  <div className="muted small">
                    {t(lang, 'colLayer')}: {layerName(s.layer)}
                    {s.requiresTurkishIp && <> · {t(lang, 'turkishIp')}</>}
                  </div>
                </td>
                <td>
                  <span className={`badge status-${s.status}`}>{STATUS_LABELS[s.status]?.[lang] ?? s.status}</span>
                </td>
                <td>{s.lastSuccessAt ? timeAgo(s.lastSuccessAt, lang, now) : t(lang, 'never')}</td>
                <td className="num">{s.itemCount}</td>
                <td>{s.newestItemAt ? timeAgo(s.newestItemAt, lang, now) : '–'}</td>
                <td className="num">{duration(s.lastDurationMs)}</td>
                <td>{interval(s.intervalSec, lang)}</td>
                <td className="error-cell">{s.lastError ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
