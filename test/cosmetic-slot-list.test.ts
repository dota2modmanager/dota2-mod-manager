/* A slot's screen lists every look of the slot (renderer/catalog/cosmetic/slot-looks.ts). A cut
 * at 400 there, from before the grid drew a page at a time, left 1764 of the game's 2164 loading
 * screens out of reach of the scroll. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { slotLooks } from '../renderer/catalog/cosmetic/slot-looks.ts';

const options = Array.from({ length: 2164 }, (_, i) => ({ id: String(i), name: `Loading Screen ${String(i).padStart(4, '0')}` }));

test('every loading screen of the slot is on its screen, and a search narrows them', () => {
  assert.equal(slotLooks('loading_screen', options, '', (l) => l).length, 2164);
  assert.deepEqual(slotLooks('loading_screen', options, 'screen 2163', (l) => l).map((l) => l.o.id), ['2163']);
});
