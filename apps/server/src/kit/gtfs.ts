import { inflateRawSync } from 'node:zlib';

/**
 * Just enough GTFS reading for Dürbün: unzip a small feed in memory and read
 * its CSV tables into objects. Large tables (a city's whole timetable) are
 * streamed elsewhere instead.
 */

/** Every file in a ZIP archive, by name (for small archives). */
export function unzipAll(zip: Buffer): Map<string, Buffer> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad ZIP directory');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** CSV rows, with quoted fields ("a, b"), a byte-order mark and Windows line ends handled. */
export function csvRows(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A CSV table as objects keyed by its header. */
export function csvTable(text: string, sep = ','): Record<string, string>[] {
  const [head, ...rows] = csvRows(text, sep);
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** "38,41395667" or "38.41395667" → 38.41395667. */
export const num = (s: string | number | null | undefined): number => Number(String(s ?? '').replace(',', '.'));
