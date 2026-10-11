/* Where Tab goes inside a window over the app, apart from the page so it can be tested under
 * plain node (test/a11y-logic.test.ts). renderer/ui/a11y.ts does the rest. */

/** Where Tab (or Shift+Tab) goes from `at` among `items`, if it has to be steered: off either end, round to the other. */
export function wrapTarget<T>(items: T[], at: T | null, back: boolean): T | null {
  if (!items.length) return null;
  const i = at === null ? -1 : items.indexOf(at);
  if (back) return i <= 0 ? items[items.length - 1] : null;
  return i === -1 || i === items.length - 1 ? items[0] : null;
}
