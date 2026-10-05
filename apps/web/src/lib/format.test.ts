import { describe, expect, it } from 'vitest';
import { dateTime, distance, interval, timeAgo, travelTime } from './format.ts';

describe('formatting', () => {
  const now = Date.parse('2026-10-05T18:00:00Z');

  it('says how long ago, in Turkish and English', () => {
    expect(timeAgo('2026-10-05T17:57:00Z', 'tr', now)).toBe('3 dakika önce');
    expect(timeAgo('2026-10-05T17:57:00Z', 'en', now)).toBe('3 minutes ago');
  });

  it('treats slightly future times as now', () => {
    expect(timeAgo('2026-10-05T18:00:04Z', 'tr', now)).toBe('şimdi');
  });

  it('shows times in Türkiye’s zone', () => {
    expect(dateTime('2026-10-05T18:00:00Z', 'tr')).toContain('21:00');
  });

  it('writes route distances and times', () => {
    expect(distance(843, 'tr')).toBe('840 m');
    expect(distance(4321, 'tr')).toBe('4,3 km');
    expect(distance(4321, 'en')).toBe('4.3 km');
    expect(distance(25_400, 'tr')).toBe('25 km');
    expect(travelTime(20, 'tr')).toBe('1 dk');
    expect(travelTime(725, 'tr')).toBe('12 dk');
    expect(travelTime(3900, 'en')).toBe('1 h 5 min');
    expect(travelTime(7200, 'tr')).toBe('2 sa');
  });

  it('writes polling intervals briefly', () => {
    expect(interval(60, 'tr')).toBe('1 dk');
    expect(interval(1800, 'en')).toBe('30 min');
  });
});
