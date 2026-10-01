/* How a mod is identified across the catalog and the library: category, name, style.
 * A leaf of its own so code that only needs the key does not pull in the router with it. */

export function keyOf(categoryId, name, styleLabel) {
  return `${categoryId}|${name}|${styleLabel || ''}`;
}
