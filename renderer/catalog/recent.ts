/* The front page's "recently added" strip against the whole list behind it (issue #292). Pure, so
 * a test can hold the rule: the strip stops at twelve, and the button to the rest is there only
 * when there is a rest. */

/** How many recent mods the front page's strip shows. */
export const RECENT_STRIP = 12;

/** The strip, and the whole list's length when the strip leaves some out (0 when it does not). */
export function recentStrip<T>(all: T[]): { strip: T[]; total: number } {
  const strip = all.slice(0, RECENT_STRIP);
  return { strip, total: all.length > strip.length ? all.length : 0 };
}
