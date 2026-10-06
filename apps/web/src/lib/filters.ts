import type { Feature, FeatureCollection, LayerSummary } from '@durbun/core';

/** What the viewer picked in the layer list: time window (hours) and minimum value per layer. */
export interface Filters {
  windows: Record<string, number>;
  minValues: Record<string, number>;
}

/** The time window (hours) in force for a layer: the viewer's choice, else the layer's default. */
export function windowFor(layer: LayerSummary, chosen: Record<string, number>): number | undefined {
  const tw = layer.timeWindows;
  if (!tw) return undefined;
  const pick = chosen[layer.id];
  return pick !== undefined && tw.options.includes(pick) ? pick : tw.default;
}

/** The minimum value in force for a layer (e.g. magnitude): the viewer's choice, else the default. */
export function minValueFor(layer: LayerSummary, chosen: Record<string, number>): number | undefined {
  const mv = layer.minValue;
  if (!mv) return undefined;
  const pick = chosen[layer.id];
  return pick !== undefined && mv.options.includes(pick) ? pick : mv.default;
}

/**
 * Features the map should show for a layer: inside its time window, at or
 * above its minimum value, and not yet expired (warnings carry an end time).
 */
export function shownFeatures(
  layer: LayerSummary,
  fc: FeatureCollection | undefined,
  filters: Filters,
  now = Date.now(),
): Feature[] {
  const features = fc?.features ?? [];
  const hours = windowFor(layer, filters.windows);
  const min = minValueFor(layer, filters.minValues);
  const cutoff = hours === undefined ? undefined : now - hours * 3_600_000;
  return features.filter((f) => {
    const p = f.properties;
    if (p.validUntil && Date.parse(p.validUntil) <= now) return false;
    if (min !== undefined && min > 0 && !((p.value ?? -Infinity) >= min)) return false;
    if (cutoff !== undefined) {
      const t = p.observedAt ? Date.parse(p.observedAt) : NaN;
      if (!(Number.isFinite(t) && t >= cutoff)) return false;
    }
    return true;
  });
}

/** "1 sa", "24 sa", "3 gün", "7 gün" / "1 h", "24 h", "3 days", "7 days". */
export function windowLabel(hours: number, lang: 'tr' | 'en'): string {
  if (hours < 48) return lang === 'tr' ? `${hours} sa` : `${hours} h`;
  const days = Math.round(hours / 24);
  return lang === 'tr' ? `${days} gün` : `${days} days`;
}

/** "Tümü" for no minimum, else "2+", "3+"… */
export function minValueLabel(value: number, lang: 'tr' | 'en'): string {
  if (value <= 0) return lang === 'tr' ? 'Tümü' : 'All';
  return `${value}+`;
}
