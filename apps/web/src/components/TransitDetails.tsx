import type { TransitLine } from '@durbun/core';
import { t } from '../i18n.ts';
import { useTransit, useUi } from '../state.ts';

/** Turkish all-capitals names from İETT ("4.LEVENT METRO") in title case. */
export function tidy(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/(^|[\s\-(/.])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase('tr-TR'))
    .replace(/\s+/g, ' ')
    .trim();
}

function LineSummary({ line }: { line: TransitLine }) {
  const lang = useUi((s) => s.lang);
  const approximate = line.routes.some((r) => r.approximate);
  return (
    <>
      <ul className="mini-list">
        <li>
          {t(lang, 'busesOnLine')}: <strong>{line.vehicles.length}</strong>
        </li>
        {line.tripMinutes !== undefined && (
          <li>
            {t(lang, 'tripTime')}: {line.tripMinutes} {t(lang, 'minutesShort')}
            {line.lengthKm !== undefined && ` · ${line.lengthKm.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB')} km`}
          </li>
        )}
        {line.fare && (
          <li>
            {t(lang, 'lineFare')}: {tidy(line.fare)}
          </li>
        )}
      </ul>
      {line.notices.length > 0 && (
        <>
          <h4>{t(lang, 'lineNotices')}</h4>
          <ul className="mini-list notices">
            {line.notices.slice(0, 5).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
      {approximate && <p className="muted small-text">{t(lang, 'routeApprox')}</p>}
    </>
  );
}

/** Line buttons: show a line on the map, or hide the one shown. */
function LineChips({ codes, names }: { codes: string[]; names?: Map<string, string> }) {
  const lang = useUi((s) => s.lang);
  const shown = useTransit((s) => s.line?.code);
  const showLine = useTransit((s) => s.showLine);
  return (
    <p className="chips">
      {codes.map((code) => (
        <button
          key={code}
          type="button"
          className={`chip chip-button ${shown === code ? 'chip-on' : ''}`}
          title={names?.get(code) ? tidy(names.get(code)!) : t(lang, 'showLine')}
          aria-pressed={shown === code}
          onClick={() => void showLine(shown === code ? undefined : code)}
        >
          {code}
        </button>
      ))}
    </p>
  );
}

/** For a selected İstanbul bus: its line now; for a stop: the lines calling there and the buses on their way. */
export function TransitDetails({ id }: { id: string }) {
  const lang = useUi((s) => s.lang);
  const select = useUi((s) => s.select);
  const answer = useTransit((s) => (s.answer?.id === id ? s.answer : undefined));
  const status = useTransit((s) => s.status);
  const line = useTransit((s) => s.line);

  if (!answer) {
    return (
      <section className="transit-view">
        <p className="muted small-text">{status === 'error' ? t(lang, 'transitFailed') : t(lang, 'loadingTransit')}</p>
      </section>
    );
  }

  if (answer.kind === 'bus') {
    const bus = answer.data;
    if (!bus.line) {
      return (
        <section className="transit-view">
          <p className="muted small-text">{t(lang, 'lineUnknown')}</p>
          {bus.recentLines.length > 0 && (
            <>
              <h4>{t(lang, 'lineYesterday')}</h4>
              <LineChips codes={bus.recentLines} />
              {line && bus.recentLines.includes(line.code) && <LineSummary line={line} />}
            </>
          )}
        </section>
      );
    }
    return (
      <section className="transit-view">
        <h3>
          <span className="line-badge">{bus.line.code}</span> {tidy(bus.line.name)}
        </h3>
        <ul className="mini-list">
          {bus.towards && (
            <li>
              {t(lang, 'busTowards')}: <strong>{tidy(bus.towards)}</strong>
            </li>
          )}
          {bus.nearestStop && (
            <li>
              {t(lang, 'nearestStop')}:{' '}
              <button type="button" className="link-button" onClick={() => select(`stop:${bus.nearestStop!.code}`)}>
                {tidy(bus.nearestStop.name)}
              </button>
            </li>
          )}
        </ul>
        <LineSummary line={bus.line} />
      </section>
    );
  }

  const stop = answer.data;
  const names = new Map(stop.lines.flatMap((l) => (l.name ? [[l.code, l.name] as [string, string]] : [])));
  return (
    <section className="transit-view">
      <h4>{t(lang, 'linesHere')}</h4>
      {stop.linesPending ? (
        <p className="muted small-text">{t(lang, 'linesLoading')}</p>
      ) : (
        <LineChips codes={stop.lines.map((l) => l.code)} names={names} />
      )}
      {line && stop.lines.some((l) => l.code === line.code) && (
        <>
          <p className="small-text">
            <span className="line-badge">{line.code}</span> {tidy(line.name)}
          </p>
          <LineSummary line={line} />
        </>
      )}
      {!stop.linesPending && (
        <>
          <h4>{t(lang, 'comingBuses')}</h4>
          {stop.arrivals.length === 0 ? (
            <p className="muted small-text">{t(lang, 'noComingBuses')}</p>
          ) : (
            <ul className="mini-list arrivals">
              {stop.arrivals.map((a) => (
                <li key={a.vehicleId + a.line}>
                  <span className="line-badge">{a.line}</span>{' '}
                  {a.stopsAway === 0 ? t(lang, 'arriving') : `${a.stopsAway} ${t(lang, 'stopsAway')}`}{' '}
                  <button type="button" className="link-button muted" onClick={() => select(a.vehicleId)}>
                    {a.doorNo}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
