import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProxyControl } from '../renderer/settings/ProxyControl.ts';

const globals = globalThis as typeof globalThis & {
  L: (strings: TemplateStringsArray, ...values: unknown[]) => string;
};
globals.L = (strings, ...values) => strings.reduce((out, text, i) => out + text + (values[i] ?? ''), '');

test('proxy settings control renders the input and actions', () => {
  const html = renderToStaticMarkup(createElement(ProxyControl, {
    value: 'http://127.0.0.1:8080',
    onSave: () => {},
    onTest: () => {},
    onClear: () => {},
  }));
  assert.match(html, /id="downloadProxyInput"/);
  assert.match(html, /value="http:\/\/127\.0\.0\.1:8080"/);
  assert.match(html, /id="downloadProxyTest"/);
  assert.match(html, /id="downloadProxySave"/);
  assert.match(html, /id="downloadProxyClear"/);
});
