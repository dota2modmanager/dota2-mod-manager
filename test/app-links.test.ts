// The site's tests read the links the site writes with site/test/helpers/app-links.mjs, a copy of
// how the app reads and writes them. This holds that copy to the app itself (Rust, through
// mm-cli), so a link the site check passes is a link the app opens. Skipped where mm-cli is not
// built, like test/rust-calls.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { encodePresetLink, decodePresetLink, modLinkUrl, parseModLink } from '../site/test/helpers/app-links.mjs';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'target', 'debug', process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');
const skip = !fs.existsSync(cli) && 'mm-cli is not built (cargo build -p mm-cli)';

function rust(calls: unknown[][]): { ok?: unknown; error?: string }[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-links-'));
  try {
    fs.writeFileSync(path.join(dir, 'calls.json'), JSON.stringify(calls));
    return JSON.parse(execFileSync(cli, ['call', path.join(dir, 'calls.json')], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const mods = [
  { categoryId: 'heroes', name: 'Pudge arcana' },
  { categoryId: 'heroes', name: 'Juggernaut "Bladeform"', styleLabel: 'Kinetic' },
  { kind: 'cosmetic', slot: 'weapon', itemId: '4004', name: 'Fractal Horns', effectId: 'ethereal' },
  { kind: 'cosmetic', slot: 'head', itemId: 77, name: 'no effect' },
  { categoryId: 'терраин', name: 'Зимний 🌨/ лес', styleLabel: '' },
];
const presets = [
  { name: 'Midlane night', author: 'tester', mods },
  { name: '', author: '', mods: [] },
  { name: 'x'.repeat(200), author: 'y'.repeat(100), mods: mods.slice(0, 2) },
];

// the two compress with different deflate code (zlib here, miniz in Rust), so the codes are compared
// by what they hold, and each side has to read the other's
const held = (code: string) => zlib.inflateRawSync(Buffer.from(code, 'base64url')).toString('utf8');

test('a preset link the helper writes holds what the app writes, and each reads the other', { skip }, () => {
  const [res] = rust([['presets.script', 'en', presets.map((p) => ['encode', p.name, p.author, p.mods])]]);
  const answers = (res.ok as { ok: { code: string; web: string; direct: string } }[]).map((a) => a.ok);
  const ours = presets.map(encodePresetLink);
  presets.forEach((p, i) => {
    assert.equal(held(answers[i].code), held(ours[i].code), p.name.slice(0, 20));
    assert.equal(answers[i].web, `https://dota2modmanager.com/p/#${answers[i].code}`);
    assert.equal(answers[i].direct, `d2mm://preset/${answers[i].code}`);
  });
  const [back] = rust([['presets.script', 'en', ours.map((o) => ['decode', o.code])]]);
  (back.ok as { ok: unknown }[]).forEach((b, i) => assert.deepEqual(b.ok, decodePresetLink(answers[i].code)));
});

test('a pasted link reads the same in the helper and in the app, and a bad one fails in both', { skip }, () => {
  const { code, web, direct } = encodePresetLink(presets[0]);
  const huge = encodePresetLink({ name: 'big', author: '', mods: Array.from({ length: 501 }, (_, i) => ({ categoryId: 'c', name: `m${i}` })) }).code;
  const inputs = [code, web, direct, ` <${direct}/> `, '`' + web + '`', `D2MM://preset/${code}`, encodePresetLink(presets[1]).code,
    'not a link', '', 'd2mm://preset/!!', 'AAAA', 'a'.repeat(70000), huge,
    Buffer.from('{"v":2,"m":[]}').toString('base64url')];
  const [res] = rust([['presets.script', 'en', inputs.map((s) => ['decode', s])]]);
  const answers = res.ok as { ok?: unknown; error?: string }[];
  inputs.forEach((s, i) => {
    let want: unknown;
    try { want = { ok: decodePresetLink(s) }; } catch { want = { error: true }; }
    const got = answers[i].error ? { error: true } : { ok: answers[i].ok };
    if ('ok' in (want as object) && (want as { ok: { name: string } }).ok.name === 'Preset') (got as { ok?: { name: string } }).ok!.name = 'Preset';
    assert.deepEqual(got, want, s.slice(0, 40));
  });
});

test('a mod link is written and read the same in the helper and in the app', { skip }, () => {
  const links = [{ cat: 'heroes', name: 'Pudge arcana', style: null }, { cat: 'hero/items', name: 'a/b c?#%', style: 'Ночь' }];
  const urls = [...links.map(modLinkUrl), 'd2mm://mod/heroes/Pudge%20arcana/', 'd2mm://mod/a/b/c/d', 'd2mm://mod/a', 'D2MM://MOD/x/y?z#w',
    'd2mm://mod/%E0%A4%A/b', 'd2mm://preset/abc', 'https://x', 'd2mm://mod/ /b'];
  const answers = rust([...links.map((l) => ['deep-links.modLinkUrl', l]), ...urls.map((u) => ['deep-links.parseModLink', u])]);
  links.forEach((l, i) => assert.equal(answers[i].ok, modLinkUrl(l)));
  urls.forEach((u, i) => assert.deepEqual(answers[links.length + i].ok, parseModLink(u), u));
});
