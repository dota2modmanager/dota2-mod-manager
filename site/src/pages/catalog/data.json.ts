/**
 * The catalog for the browser on /catalog/: every mod, in the compact shape src/lib/catalog.ts
 * describes. One file for both languages, since only the category and hero names differ and
 * both are in it.
 */
import { catalog, catalogPayload } from '../../lib/catalog';
import { authorOf } from '../../lib/authors';

export function GET() {
  // the author's page, where they have one (src/lib/authors.ts), goes on the end of each row: the
  // cards drawn from this file lead there the way the ones in the HTML do
  const payload = catalogPayload();
  payload.mods.forEach((row, i) => row.push(authorOf(catalog[i])?.slug ?? ''));
  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
}
