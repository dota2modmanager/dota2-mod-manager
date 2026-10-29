/* What paints over what, read straight out of the stylesheets.
 *
 * The title bar's menus drop down over the page, so nothing the page floats (the catalog's toolbar
 * above all) may sit on a level above the bar's: issue #357 was the toolbar at 25 over a bar at 20,
 * with the help menu behind it and impossible to click. And the bloody night's dressing, whose
 * streaks once ran down forever and whose stains darkened wherever their circles met (#359, #360).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'styles');
const css = (name: string): string => fs.readFileSync(path.join(STYLES, name), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(source: string, selector: string): string {
  const at = source.search(new RegExp(`(^|\\n)${selector.replace(/[\\^$.*+?()[\]{}|#]/g, '\\$&')}\\s*\\{`));
  assert.ok(at >= 0, `${selector} has a rule`);
  const open = source.indexOf('{', at);
  return source.slice(open + 1, source.indexOf('}', open));
}

const tokens = css('tokens.css');
const token = (name: string): number => Number(tokens.match(new RegExp(`${name}:\\s*(-?\\d+)`))![1]);

/** A z-index as a number: a plain one, a token, or calc(token - n). */
function zOf(decls: string): number {
  const v = decls.match(/z-index:\s*([^;]+);/)![1].trim();
  if (/^-?\d+$/.test(v)) return Number(v);
  const m = v.match(/^(?:calc\()?var\((--[\w-]+)\)(?:\s*([+-])\s*(\d+)\))?$/);
  assert.ok(m, `a z-index this test can read: ${v}`);
  return token(m[1]) + (m[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0);
}

test('the catalog toolbar sits under the title bar, so the bar\'s menus open over it (#357)', () => {
  const bar = zOf(rule(css('shell.css'), '#titlebar'));
  const toolbar = zOf(rule(css('controls.css'), '.toolbar'));
  assert.ok(toolbar < bar, `toolbar ${toolbar} below title bar ${bar}`);
  // and still over the cards it floats above
  assert.ok(toolbar > 3, `toolbar ${toolbar} above the cards`);
});

test('the blood streaks run down once and are not squashed on the way (#360)', () => {
  const blood = css('blood.css');
  const streak = rule(blood, '.bn-band i');
  assert.doesNotMatch(streak, /infinite/);
  assert.doesNotMatch(blood.match(/@keyframes bnOoze[^}]*\}[^}]*\}/)![0], /scale/);
});

test('the stains on the floor are see-through as a whole, not circle by circle (#359)', () => {
  const blood = css('blood.css');
  const floor = blood.slice(blood.indexOf("[data-theme='blood'] body"));
  assert.match(floor, /data:image\/svg/);
  assert.doesNotMatch(floor.slice(0, floor.indexOf('}')), /fill-opacity/);
});
