/* The colour a look carries in the catalog, made safe to put in a style attribute. */

/** The value as the catalog wrote it when it is plain CSS colour syntax, else nothing. */
export function cssColor(v: unknown): string {
  const s = String(v || '').trim();
  return /^[#\w(),.%\s-]+$/.test(s) ? s : 'transparent';
}

/* Washes, rings and glows are mixed from the look's colour, and a mix needs a colour rather than a
 * picture: two mods ship a two-stop gradient there. Its first stop stands in for the whole thing
 * wherever a flat value is required; the dot on the card keeps the gradient. */
export function flatColor(v: unknown): string {
  const s = String(v || '');
  const hex = (s.match(/#[0-9a-f]{3,8}\b/i) || [])[0];
  if (hex) return hex;
  return /gradient|[;{}]/i.test(s) || !s.trim() ? 'var(--md-primary)' : cssColor(s);
}
