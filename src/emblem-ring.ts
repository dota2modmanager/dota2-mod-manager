/* An emblem mod draws on the ring under the selected hero, and Dota hides that ring unless the
 * console variable r_draw_selected_ring is 1. Almost every "my emblem does not show" in the
 * support channel (October and November 2026) was answered with that one line, typed again by
 * hand. So while an emblem is switched on, the app keeps the line in the game's autoexec.cfg,
 * which Dota runs at every start, and takes it out again when no emblem is left.
 *
 * The line goes in under a comment of ours, and only our two lines are ever touched: whatever
 * else the user keeps in autoexec stays as it was. A line of their own that already sets the
 * variable is left to do the job. */
import fs from 'node:fs';
import path from 'node:path';

/** The comment the line sits under, which is how the app knows the line is its own. */
export const RING_MARK = '// Dota 2 Mod Manager: emblems show on the selection ring';
/** The command that shows the ring. */
export const RING_LINE = 'r_draw_selected_ring 1';

/** The categories whose mods need the ring. */
export const RING_CATEGORIES = new Set(['emblems']);

/** autoexec's text with our line in it when `on`, without it otherwise; the user's lines kept. */
export function withRing(text: string, on: boolean): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === RING_MARK) {
      if (lines[i + 1]?.trim() === RING_LINE) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  const theirs = kept.some((l) => /^\s*r_draw_selected_ring\s+"?1"?\s*(\/\/.*)?$/.test(l));
  if (on && !theirs) kept.push(RING_MARK, RING_LINE);
  return kept.length ? kept.join(eol) + eol : '';
}

/**
 * Put the line in or take it out of <game>/dota/cfg/autoexec.cfg. Writes only when the text
 * changes, and makes no file when there is nothing to put in one.
 * @returns what changed, or null
 */
export function keepRing(gamePath: string, on: boolean): 'added' | 'removed' | null {
  const file = path.join(gamePath, 'dota', 'cfg', 'autoexec.cfg');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { if (!on) return null; }
  const next = withRing(text, on);
  if (next === text) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return on ? 'added' : 'removed';
}
