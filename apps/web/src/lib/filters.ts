import type { Feature, FeatureCollection, LayerSummary } from '@durbun/core';

/** The time window (hours) in force for a layer: the viewer's choice, else the layer's default. */
export function windowFor(layer: LayerSummary, chosen: Record<string, number>): number | undefined {
  const tw = layer.timeWindows;
  if (!tw) return undefined;
  const pick = chosen[layer.id];
  return pick !== undefined && tw.options.includes(pick) ? pick : tw.default;
}

/** Features the map should show for a layer, after its time window. */
export function shownFeatures(
  layer: LayerSummary,
  fc: FeatureCollection | undefined,
  chosen: Record<string, number>,
  now = Date.now(),
): Feature[] {
  const features = fc?.features ?? [];
  const hours = windowFor(layer, chosen);
  if (hours === undefined) return features;
  const cutoff = now - hours * 3_600_000;
  return features.filter((f) => {
    const t = f.properties.observedAt ? Date.parse(f.properties.observedAt) : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });
}

/** "1 sa", "24 sa", "3 gün", "7 gün" / "1 h", "24 h", "3 days", "7 days". */
export function windowLabel(hours: number, lang: 'tr' | 'en'): string {
  if (hours < 48) return lang === 'tr' ? `${hours} sa` : `${hours} h`;
  const days = Math.round(hours / 24);
  return lang === 'tr' ? `${days} gün` : `${days} days`;
}
