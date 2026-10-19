/* What the ninth theme looks like today (ui/theme.ts).
 *
 * The theme is the one the pumpkin opens, and what it wears follows the calendar: during an
 * event the event's own look, the rest of the year the rainbow. The same table as the site's
 * (site/src/scripts/look.ts), and test/season.test.ts holds the two to each other, so the reward
 * on the site and in the window always match.
 */

export type Look = 'rainbow' | 'halloween';

/** Each event's look and the days it is worn, as [month, day], both ends included. */
export const EVENTS: Array<{ look: Look; from: [number, number]; to: [number, number] }> = [
  { look: 'halloween', from: [10, 15], to: [11, 10] },
];

/** The look of a day: an event's, when one is on, and the rainbow otherwise. */
export function lookOn(date: Date): Look {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  for (const e of EVENTS) {
    const from = e.from[0] * 100 + e.from[1];
    const to = e.to[0] * 100 + e.to[1];
    if (from <= to ? md >= from && md <= to : md >= from || md <= to) return e.look;
  }
  return 'rainbow';
}
