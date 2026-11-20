/* The catalog's rail, laid out: each category the catalog has under the section this app gives
 * it (RAIL_SECTIONS), and a category it has never heard of under the last section, "Прочее".
 * The catalog adds categories on its own schedule; before this, "hero-icons" and its 17 mods
 * were in the catalog for weeks with no entry in the rail. */
import { CATALOG_EXCLUDE, RAIL_SECTIONS } from '../core/constants.ts';

export function railSections(present: Iterable<string>): [label: string, ids: string[]][] {
  const have = [...present].filter((id) => !CATALOG_EXCLUDE.includes(id));
  const known = new Set(RAIL_SECTIONS.flatMap(([, ids]) => ids));
  const unknown = have.filter((id) => !known.has(id));
  const last = RAIL_SECTIONS.length - 1;
  return RAIL_SECTIONS
    .map(([label, ids], i): [string, string[]] => [label, [...ids.filter((id) => have.includes(id)), ...(i === last ? unknown : [])]])
    .filter(([, ids]) => ids.length > 0);
}
