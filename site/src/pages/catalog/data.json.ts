/**
 * The catalog for the browser on /catalog/: every mod, in the compact shape src/lib/catalog.ts
 * describes. One file for both languages, since only the category and hero names differ and
 * both are in it.
 */
import { catalogPayload } from '../../lib/catalog';

export function GET() {
  return new Response(JSON.stringify(catalogPayload()), { headers: { 'Content-Type': 'application/json' } });
}
