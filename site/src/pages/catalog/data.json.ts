/**
 * The catalog for the browser on /catalog/: every mod, in the compact shape src/lib/catalog.ts
 * describes. One file for both languages, since only the category and hero names differ and
 * both are in it.
 */
import { adultCatalog, catalog, catalogPayload } from '../../lib/catalog';
import { authorOf } from '../../lib/authors';

export function GET() {
  // the author's page, where they have one (src/lib/authors.ts), goes on the end of each row: the
  // cards drawn from this file lead there the way the ones in the HTML do. After it, the download
  // counter's key when it is not plain category/name (a mod in a group), '' when it is
  const payload = catalogPayload();
  const byKey = new Map([...catalog, ...adultCatalog].map((m) => [m.key, m]));
  const tail = (rows: typeof payload.mods) => rows.forEach((row) => {
    const m = byKey.get(row[0] as string)!;
    row.push(authorOf(m)?.slug ?? '', m.countKey === `${m.cat}/${m.name}` ? '' : m.countKey);
  });
  tail(payload.mods);
  tail(payload.adult);
  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
}
