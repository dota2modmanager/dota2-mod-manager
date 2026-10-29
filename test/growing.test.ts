/* A long list drawn a page at a time (renderer/ui/growing.ts, issue #358): the first page and a
 * marker carrying the whole length, and a short list drawn whole with no marker at all. What the
 * marker does when it scrolls into view is the browser's part, and the simulation's scroll and
 * browse scenarios go through it on the six hundred heroes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { GrowMarker, PAGE, useGrowing } from '../renderer/ui/growing.ts';

function List({ n }: { n: number }) {
  const { limit, marker, more } = useGrowing(n, 'list');
  const items = Array.from({ length: limit }, (_, i) => createElement('i', { key: i }));
  return createElement(Fragment, null, ...items, more ? createElement(GrowMarker, { key: 'm', marker, total: n, className: 'grid-more' }) : null);
}

const count = (html: string) => (html.match(/<i>/g) || []).length;

test('a long list starts with one page and a marker that knows the whole length', () => {
  const html = renderToStaticMarkup(createElement(List, { n: 611 }));
  assert.equal(count(html), PAGE);
  assert.match(html, /class="grid-more" data-total="611" aria-hidden="true"/);
});

test('a list that fits in a page is drawn whole, with no marker', () => {
  const html = renderToStaticMarkup(createElement(List, { n: PAGE }));
  assert.equal(count(html), PAGE);
  assert.doesNotMatch(html, /grid-more/);
  assert.equal(count(renderToStaticMarkup(createElement(List, { n: 3 }))), 3);
});
