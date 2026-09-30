/* The anti-cheat notice in plain words (src/notice-text.js, src/notice-texts.ts).
 *
 * A throwaway game tree with Valve's localization in dota/pak01 and a language folder beside
 * it: the pak the app writes has to carry the chat file the game would have read, with the four
 * strings in the language the player sees, and it has to stay out of the way of every file that
 * is not ours.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const vpk = require('../src/vpk.ts');
const gamelang = require('../src/gamelang.ts');
const notice = require('../src/notice-text');
const { NOTICE_TEXTS, NOTICE_KEYS } = require('../src/notice-texts.ts');

const BOM = '﻿';
const chatFile = (language, extra = '') =>
  `${BOM}"lang"\r\n{\r\n"Language" "${language}"\r\n"Tokens"\r\n{\r\n"chat_filterbutton"\t"Filters"\r\n"chat_brace"\t"a } in a value"\r\n${extra}}\r\n}\r\n`;

/** A VPK holding `files` (inner path -> text). */
function pak(files) {
  return vpk.buildVpk(Object.entries(files).map(([rel, text]) => {
    const data = Buffer.from(text, 'utf8');
    const slash = rel.lastIndexOf('/');
    const file = rel.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    return { ext: file.slice(dot + 1), folder: rel.slice(0, slash), name: file.slice(0, dot), data, preload: Buffer.alloc(0), crc: vpk.crc32(data) };
  }));
}

/** A game with Valve's chat files, the game's own language setting, and a language folder. */
function stand(t, { ui = 'russian', folder = 'russian' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-notice-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // a Steam with one account and no launch options, so nothing is read off the machine's own
  fs.mkdirSync(path.join(root, 'userdata', '1'), { recursive: true });
  const game = path.join(root, 'steamapps', 'common', 'dota 2 beta', 'game');
  fs.mkdirSync(path.join(game, 'dota', 'cfg'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), `"config"\n{\n\t"UILanguage"\t\t"${ui}"\n\t"AudioLanguage"\t\t"${folder}"\n}\n`);
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), pak({
    'resource/localization/chat_russian.txt': chatFile('russian'),
    'resource/localization/chat_english.txt': chatFile('English'),
    'resource/localization/chat_dutch.txt': chatFile('dutch'),
    'resource/localization/dota_russian.txt': `${BOM}"lang"\r\n{\r\n"Language" "russian"\r\n"Tokens"\r\n{\r\n}\r\n}\r\n`,
  }));
  const langDir = path.join(game, `dota_${folder}`);
  fs.mkdirSync(langDir, { recursive: true });
  const target = path.join(langDir, notice.NOTICE_PAK);
  /** The chat file inside what the app wrote. */
  const written = (lang = ui) => vpk.openVpkIndex(target).read(`resource/localization/chat_${lang}.txt`).toString('utf8');
  return { game, langDir, target, written };
}

test('the pak carries the game\'s own chat file with the four strings added, in the game\'s language', (t) => {
  const s = stand(t);
  assert.equal(notice.applyNotice({ gamePath: s.game, langDir: s.langDir }), 'written (russian)');
  const text = s.written();
  assert.ok(text.startsWith(`${BOM}"lang"`), 'the byte order mark stays where Valve put it');
  assert.ok(text.includes('"chat_filterbutton"\t"Filters"') && text.includes('"a } in a value"'), 'everything the file said before is still there');
  for (const [what, key] of Object.entries(NOTICE_KEYS)) {
    assert.ok(text.includes(`"${key}"\t"${NOTICE_TEXTS.russian[what]}"\r\n`), `${key} in Russian, in the file's own line ending`);
  }
  assert.ok(/"DOTA_VAC_Verification_Header_Party"\t"[^"]*"\r\n}\r\n}\r\n$/.test(text), 'inside the Tokens block, at its end');
  assert.equal(notice.applyNotice({ gamePath: s.game, langDir: s.langDir }), 'up to date (russian)', 'the same game gives the same bytes, and nothing is rewritten');
});

test('a Minify "English fix" means English text, built on top of its own chat file', (t) => {
  const s = stand(t, { ui: 'dutch', folder: 'dutch' });
  fs.writeFileSync(path.join(s.langDir, 'pak66_dir.vpk'), pak({
    'resource/localization/chat_dutch.txt': chatFile('English', '"minify_says"\t"hi"\r\n'),
    'resource/localization/dota_dutch.txt': `${BOM}"lang"\r\n{\r\n\t"Language" "English"\r\n\t"Tokens"\r\n\t{\r\n\t}\r\n}\r\n`,
  }));
  assert.equal(notice.applyNotice({ gamePath: s.game, langDir: s.langDir }), 'written (english)');
  const text = s.written();
  assert.ok(text.includes('"minify_says"'), 'the chat file the game would have read is Minify\'s, so that is the one carried');
  assert.ok(text.includes(NOTICE_TEXTS.english.warning));
});

test('a pak read before ours that carries the chat file wins: ours goes, and a foreign pak64 is never touched', (t) => {
  const s = stand(t);
  notice.applyNotice({ gamePath: s.game, langDir: s.langDir });
  fs.writeFileSync(path.join(s.langDir, 'pak03_dir.vpk'), pak({ 'resource/localization/chat_russian.txt': chatFile('russian') }));
  assert.match(notice.applyNotice({ gamePath: s.game, langDir: s.langDir }), /^removed: pak03_dir\.vpk carries/);

  fs.rmSync(path.join(s.langDir, 'pak03_dir.vpk'));
  // 'wx' creates the file or throws: ours being gone is checked by the same call that writes
  fs.writeFileSync(s.target, 'somebody else\'s mod', { flag: 'wx' });
  assert.match(notice.applyNotice({ gamePath: s.game, langDir: s.langDir }), /^skipped: /);
  assert.equal(notice.removeNotice(s.langDir), false);
  assert.equal(fs.readFileSync(s.target, 'utf8'), 'somebody else\'s mod');
});

test('a language the game has no chat file for writes nothing, and the uninstaller removes only ours', (t) => {
  const s = stand(t, { ui: 'klingon' });
  assert.match(notice.applyNotice({ gamePath: s.game, langDir: s.langDir }), /^not needed: the game has no/);
  assert.ok(!fs.existsSync(s.target));

  const r = stand(t);
  notice.applyNotice({ gamePath: r.game, langDir: r.langDir });
  assert.equal(notice.removeNotice(r.langDir), true);
  assert.ok(!fs.existsSync(r.target));
  assert.equal(notice.applyNotice({ gamePath: r.game, langDir: path.join(r.game, 'dota_nowhere') }), 'no language folder');
});

test('the kept notice rebuilds only when something it reads changed, and retries a refused write later', (t) => {
  const s = stand(t);
  const log = [];
  const kept = notice.createNoticeText({ gamePath: () => s.game, langDir: () => s.langDir, diag: (m) => log.push(m), retryMs: 0 });
  assert.equal(kept.refresh(), 'written (russian)');
  assert.equal(kept.refresh(), null, 'nothing changed, nothing read');
  assert.deepEqual(kept.ownedFiles(), [notice.NOTICE_PAK]);

  fs.writeFileSync(path.join(s.game, 'dota', 'cfg', 'boot.vcfg'), '"config"\n{\n\t"UILanguage"\t\t"english"\n}\n');
  assert.equal(kept.refresh(), 'written (english)', 'a new game language is a new text');

  // the running game holds the pak open: the write fails, and is tried again
  fs.writeFileSync(path.join(s.game, 'dota', 'cfg', 'boot.vcfg'), '"config"\n{\n\t"UILanguage"\t\t"russian"\n}\n');
  const real = fs.renameSync;
  t.after(() => { fs.renameSync = real; });
  fs.renameSync = () => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); };
  assert.match(kept.refresh(), /^failed: EBUSY/);
  assert.ok(!fs.existsSync(`${s.target}.tmp`), 'no half-written file is left behind');
  fs.renameSync = real;
  assert.equal(kept.refresh(), 'written (russian)');
  assert.ok(log.some((m) => /notice text skipped: EBUSY/.test(m)));
});

test('the tokens go into the Tokens block whatever its braces and line endings, replacing an old copy', () => {
  const lf = '"lang"\n{\n"Language" "x"\n"Tokens"\n{\n"k"\t"{ not a block }"\n"DOTA_VAC_Verification_Header"\t"old"\n}\n}\n';
  assert.equal(
    notice.withTokens(lf, { DOTA_VAC_Verification_Header: 'new' }),
    '"lang"\n{\n"Language" "x"\n"Tokens"\n{\n"k"\t"{ not a block }"\n"DOTA_VAC_Verification_Header"\t"new"\n}\n}\n',
  );
  assert.equal(notice.withTokens('"lang" { "Language" "x" }', { a: 'b' }), null, 'no Tokens block, nothing to build on');
  assert.equal(notice.withTokens('"lang"{"Tokens"{"a" "b"}}', { c: 'd' }), '"lang"{"Tokens"{"a" "b"\n"c"\t"d"\n}}');
  assert.equal(notice.declaredLanguage('﻿"lang"\r\n{\r\n\t"Language" "English"'), 'english');
  assert.equal(notice.declaredLanguage('"lang" {}'), null);
});

test('every language the game ships has all four strings, none of which can break the file', () => {
  assert.deepEqual(Object.keys(NOTICE_TEXTS).sort(), [...gamelang.DOTA_LANGUAGES].sort());
  for (const [lang, texts] of Object.entries(NOTICE_TEXTS)) {
    assert.deepEqual(Object.keys(texts).sort(), Object.keys(NOTICE_KEYS).sort(), lang);
    for (const [what, value] of Object.entries(texts)) {
      assert.ok(value.trim().length > 3, `${lang}.${what} says something`);
      assert.ok(!/["\\\r\n]/.test(value), `${lang}.${what} has no quote, backslash or line break`);
      assert.ok(!/VAC/.test(value), `${lang}.${what} does not name VAC`);
      if (what !== 'header') assert.ok(value.includes('Dota 2 Mod Manager'), `${lang}.${what} names the app`);
    }
  }
  assert.ok(NOTICE_TEXTS.russian.warning.includes('«Моды»'), 'the switch is named as the Russian app shows it');
});
