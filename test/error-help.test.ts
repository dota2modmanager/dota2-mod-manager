// Where "What do I do?" on an error toast leads (renderer/ui/error-help.ts, issue #424).
import test from 'node:test';
import assert from 'node:assert/strict';

import { errorHelpUrl } from '../renderer/ui/error-help.ts';

const GUIDE = 'https://dota2modmanager.com/docs/troubleshooting/';

test('an error that names nothing the guide knows opens the top of the guide', () => {
  assert.equal(errorHelpUrl('Could not download Axe.zip: socket hang up', 'en'), GUIDE);
});

test('a Russian window opens the Russian guide', () => {
  assert.equal(errorHelpUrl('Что-то пошло не так', 'ru'), 'https://dota2modmanager.com/ru/docs/troubleshooting/');
});

test('a language the site has no copy in gets the English guide', () => {
  assert.equal(errorHelpUrl('出了点问题', 'zh-CN'), GUIDE);
});

test('words about an update lead to the section about updates, in each language', () => {
  for (const [msg, lang] of [['Dota update moved the files', 'en'], ['После обновления Доты', 'ru'], ['Dota 更新后', 'zh-CN']]) {
    assert.match(errorHelpUrl(msg, lang), /#patch$/, msg);
  }
});

test('a game that will not start leads to the section about crashes', () => {
  assert.match(errorHelpUrl('Dota 2 не запускается', 'ru'), /#crash$/);
  assert.match(errorHelpUrl('The game will not start', 'en'), /#crash$/);
});

test('every anchor it can give is a section the guide has', async () => {
  const { docs } = await import('../site/src/i18n/docs.ts');
  for (const lang of ['en', 'ru'] as const) {
    const ids = new Set(docs[lang].troubleshooting.blocks.map((b) => ('id' in b ? b.id : undefined)).filter(Boolean));
    for (const msg of ['update', 'crash', 'conflict', 'nothing changed']) {
      const anchor = errorHelpUrl(msg, lang).split('#')[1];
      assert.ok(anchor && ids.has(anchor), `${lang}: #${anchor} for "${msg}"`);
    }
  }
});
