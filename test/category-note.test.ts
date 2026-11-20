import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryNote, noteParts } from '../renderer/catalog/category-note.ts';

test('a note is cut into text, code and links, and no markup survives', () => {
  assert.deepEqual(noteParts('If emblem not working, try enter <code>r_draw_selected_ring 1</code> into the console.'), [
    { kind: 'text', text: 'If emblem not working, try enter ' },
    { kind: 'code', text: 'r_draw_selected_ring 1' },
    { kind: 'text', text: ' into the console.' },
  ]);
  assert.deepEqual(
    noteParts('Use <a href="https://h6rd.github.io/Dota2PornFxWeb/?category=ti-bp-effects"><span id="tg">Effect Packs</span></a>.'),
    [{ kind: 'text', text: 'Use ' }, { kind: 'link', text: 'Effect Packs', cat: 'ti-bp-effects' }, { kind: 'text', text: '.' }],
  );
  assert.deepEqual(noteParts('<a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>&amp;'), [
    { kind: 'text', text: 'x' },
    { kind: 'text', text: '&' },
  ]);
  assert.deepEqual(noteParts('<a href="https://example.com/a?category=x&mod=y">mod</a>'), [
    { kind: 'link', text: 'mod', url: 'https://example.com/a?category=x&mod=y' },
  ]);
});

test('only a note the catalog switched on is shown', () => {
  const notes = {
    emblems: { enabled: true, text: 'Try <code>r_draw_selected_ring 1</code>' },
    'item-effects': { enabled: false, text: 'During events some effects will not work.' },
    parts: { enabled: true, text: '   ' },
  };
  assert.equal(categoryNote(notes, 'emblems')?.length, 2);
  assert.equal(categoryNote(notes, 'item-effects'), null);
  assert.equal(categoryNote(notes, 'parts'), null);
  assert.equal(categoryNote(notes, 'heroes'), null);
  assert.equal(categoryNote(undefined, 'emblems'), null);
});
