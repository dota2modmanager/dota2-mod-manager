/* When the window asking people to support the project comes up on its own.
 *
 * Not on the first two launches: on the first somebody is still finding their way, on the
 * second they may not have installed anything yet. By the third they came back by themselves.
 * "Later" puts it away for a week, three times at most; after that, and after "I did it" or a
 * click on any of its actions, it only opens from Settings. A window that came back every day
 * would get the project talked about, just not in the way it asks for.
 */

/** What settings.json keeps about the window, under supportPrompt. */
export interface SupportPrompt {
  /** launches of the app counted so far, this one included */
  launches: number;
  /** 'done' once the user helped, said they had, or ran out of reminders */
  state: 'new' | 'later' | 'done';
  /** not shown before this moment (ms since epoch) */
  until: number;
  /** how many times "later" was pressed */
  later: number;
}

/** The launch it first opens on. */
export const FIRST_LAUNCH = 3;
/** How long "later" puts it away for: a week. */
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** How many times it comes back after the first. */
export const MAX_REMINDERS = 3;

const FRESH: SupportPrompt = { launches: 0, state: 'new', until: 0, later: 0 };

/** Whatever settings.json holds, as a prompt state: a missing or hand-edited value starts fresh. */
export function readPrompt(raw: unknown): SupportPrompt {
  if (!raw || typeof raw !== 'object') return { ...FRESH };
  const r = raw as Partial<SupportPrompt>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const state = r.state === 'later' || r.state === 'done' ? r.state : 'new';
  return { launches: n(r.launches), state, until: n(r.until), later: n(r.later) };
}

/** One more launch. */
export function counted(p: SupportPrompt): SupportPrompt {
  return { ...p, launches: p.launches + 1 };
}

/** Whether the window opens on its own now. */
export function due(p: SupportPrompt, now: number): boolean {
  return p.state !== 'done' && p.launches >= FIRST_LAUNCH && now >= p.until;
}

/** What the user's answer leaves behind. */
export function choose(p: SupportPrompt, choice: 'later' | 'done', now: number): SupportPrompt {
  if (choice === 'done') return { ...p, state: 'done' };
  const later = p.later + 1;
  if (later > MAX_REMINDERS) return { ...p, later, state: 'done' };
  return { ...p, later, state: 'later', until: now + SNOOZE_MS };
}
