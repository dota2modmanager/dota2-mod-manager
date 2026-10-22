/**
 * What the hunt's reward looks like today.
 *
 * The page that earned the reward wears it from then on, and what it wears follows the calendar:
 * during an event the event's own look, the rest of the year the rainbow. One table of events,
 * the same one the app keeps in renderer/ui/season.ts (test/season.test.ts holds the two to each
 * other), and the one line in the head that puts the look on before the first paint reads it
 * too (lib/inline-scripts.ts EARLY_LOOK).
 *
 * `mm-look` in localStorage names a look outright, for trying one outside its dates.
 */

export type Look = 'rainbow' | 'halloween';
export const LOOKS: Look[] = ['rainbow', 'halloween'];

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

/** Today's look, or the one `mm-look` asks for. */
export function lookNow(): Look {
  try {
    const asked = localStorage.getItem('mm-look') as Look | null;
    if (asked && LOOKS.includes(asked)) return asked;
  } catch { /* private mode */ }
  return lookOn(new Date());
}

/** Whether the page is wearing the reward, in whichever look. */
export const wearing = () => LOOKS.some((l) => document.documentElement.classList.contains(l));

/** Put the reward on or take it off, in today's look. Tells the page with an 'mm-look' event. */
export function wear(on: boolean): void {
  const html = document.documentElement;
  for (const l of LOOKS) html.classList.remove(l);
  if (on) html.classList.add(lookNow());
  document.dispatchEvent(new Event('mm-look'));
}
