// Which dota_<lang> folder the game mounts, and therefore where mods have to go. This is the
// single most common cause of "my mods do nothing": the engine substitutes the AUDIO language
// into its Game_Language search path and mounts nothing at all for English, so a mod sitting
// in a folder the game never mounts is invisible with no error anywhere.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as gamelang from '../src/gamelang.ts';

/* A game on a second drive keeps no userdata beside it, so launchLanguage() also looks where
 * Steam installs by default - which on a developer's machine is a real Steam with real launch
 * options. Every test here describes a whole machine, so for the length of this file that
 * lookup is pointed at an empty directory. Without it the suite passes or fails depending on
 * whether whoever is running it happens to have -language set in their own Dota. */
const NO_STEAM = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-nosteam-'));
const REAL_PF = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles];
process.env['ProgramFiles(x86)'] = NO_STEAM;
process.env.ProgramFiles = NO_STEAM;
process.on('exit', () => {
  [process.env['ProgramFiles(x86)'], process.env.ProgramFiles] = REAL_PF;
  try { fs.rmSync(NO_STEAM, { recursive: true, force: true }); } catch { /* going away anyway */ }
});

/** A throwaway ...\dota 2 beta\game tree. Returns the game path. */
function fakeGame(t: TestContext, { boot, steamLang, folders = {} }: { boot?: string; steamLang?: string; folders?: Record<string, string[]> } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-lang-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const game = path.join(root, 'steamapps', 'common', 'dota 2 beta', 'game');
  fs.mkdirSync(path.join(game, 'dota', 'cfg'), { recursive: true });

  if (boot) fs.writeFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), boot);
  if (steamLang) {
    fs.writeFileSync(
      path.join(root, 'steamapps', 'appmanifest_570.acf'),
      `"AppState"\n{\n\t"appid"\t\t"570"\n\t"MountedConfig"\n\t{\n\t\t"language"\t\t"${steamLang}"\n\t}\n}\n`
    );
  }
  for (const [name, files] of Object.entries(folders)) {
    fs.mkdirSync(path.join(game, name), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(game, name, f), '');
  }
  return game;
}

const bootFile = (ui: string, audio: string) =>
  `"boot"\n{\n\t"UILanguage"\t\t"${ui}"\n\t"AudioLanguage"\t\t"${audio}"\n}\n`;

test('the two language settings are read separately', (t) => {
  const game = fakeGame(t, { boot: bootFile('english', 'russian') });
  // The combination most of the audience actually runs: English text, Russian voice - and it
  // is the voice language that decides the mod folder.
  assert.deepEqual(gamelang.bootLanguages(game), { ui: 'english', audio: 'russian' });
});

test('audio falls back to the UI language when the game recorded only one', (t) => {
  const game = fakeGame(t, { boot: '"boot"\n{\n\t"UILanguage"\t\t"german"\n}\n' });
  assert.deepEqual(gamelang.bootLanguages(game), { ui: 'german', audio: 'german' });
});

test('a game that has never booted reports no languages rather than a guess', (t) => {
  const game = fakeGame(t, {});
  assert.equal(gamelang.bootLanguages(game), null);
});

test("Steam's own language is the fallback before the game has ever run", (t) => {
  const game = fakeGame(t, { steamLang: 'russian' });
  assert.equal(gamelang.steamLanguage(game), 'russian');
  assert.deepEqual(gamelang.detectLangSuffix(game), {
    suffix: 'russian',
    source: 'steam',
    uiLanguage: null,
    audio: 'russian',
  });
});

test("the game's own setting wins over Steam's", (t) => {
  const game = fakeGame(t, { boot: bootFile('english', 'russian'), steamLang: 'schinese' });
  const got = gamelang.detectLangSuffix(game);
  assert.equal(got.suffix, 'russian');
  assert.equal(got.source, 'boot');
  assert.equal(got.uiLanguage, 'english');
});

test('an audio language Dota does not ship is ignored in favour of Steam', (t) => {
  const game = fakeGame(t, { boot: bootFile('english', 'klingon'), steamLang: 'russian' });
  const got = gamelang.detectLangSuffix(game);
  assert.equal(got.suffix, 'russian');
  assert.equal(got.source, 'steam');
});

test('with nothing official to go on the suffix is null, not a default', (t) => {
  const game = fakeGame(t, { boot: bootFile('klingon', 'klingon') });
  assert.deepEqual(gamelang.detectLangSuffix(game), {
    suffix: null,
    source: null,
    uiLanguage: 'klingon',
    // unrecognised, but still reported: this is the value the engine builds its mount path
    // from, and another mod manager setting it is exactly how mods end up somewhere we do
    // not look (see src/minify.ts)
    audio: 'klingon',
  });
});

test('every voice language gets the folder the engine will actually mount', () => {
  // Three of Dota's four voice languages have a folder of their own and keep it.
  assert.equal(gamelang.folderFor('russian'), 'russian');
  assert.equal(gamelang.folderFor('koreana'), 'koreana');
  assert.equal(gamelang.folderFor('schinese'), 'schinese');
});

test('English borrows the Russian folder, because it has none of its own', () => {
  // English speech ships inside dota/pak01, so Valve makes no dota_english and its gameinfo
  // mounts no language path for English at all. A dota_english built by hand is never read.
  assert.equal(gamelang.folderFor('english'), 'russian');
  assert.ok(!gamelang.MOD_FOLDERS.includes('english'));
});

test('an unknown audio language falls back rather than inventing a folder', () => {
  assert.equal(gamelang.folderFor('klingon'), 'russian');
  assert.equal(gamelang.folderFor(null), 'russian');
  assert.equal(gamelang.folderFor(undefined), 'russian');
});

test('the voice languages are the four Dota records, not the text languages', () => {
  // Reading the wrong one of the two lists is how a mod lands in a folder nobody mounts:
  // Dota has text in twenty-nine languages and voice in four.
  assert.deepEqual([...gamelang.VOICE_LANGUAGES].sort(), ['english', 'koreana', 'russian', 'schinese']);
  assert.ok(!gamelang.VOICE_LANGUAGES.includes('german'));
});

test("Valve's voice paks and our mod paks are told apart", (t) => {
  const game = fakeGame(t, {
    folders: {
      // pak01_* is the voice-over; everything else in here is a mod
      dota_russian: ['pak01_dir.vpk', 'pak01_000.vpk', 'pak10_dir.vpk', 'pak11_dir.vpk.off'],
    },
  });
  const [ru] = gamelang.langFolders(game);
  assert.equal(ru.suffix, 'russian');
  assert.equal(ru.official, true);
  assert.equal(ru.valveContent, true, 'pak01 present means the voice pack is installed');
  assert.equal(ru.modFiles, 2, 'a disabled mod still counts as ours');
});

test('a language folder holding only mods is not reported as Valve content', (t) => {
  const game = fakeGame(t, { folders: { dota_russian: ['pak10_dir.vpk'] } });
  const [ru] = gamelang.langFolders(game);
  assert.equal(ru.valveContent, false);
  assert.equal(ru.modFiles, 1);
});

test('addons, low violence and core are not language layers', (t) => {
  const game = fakeGame(t, {
    folders: { dota_addons: [], dota_lv: ['pak01_dir.vpk'], dota_core: [], dota_russian: [] },
  });
  assert.deepEqual(gamelang.langFolders(game).map((f) => f.suffix), ['russian']);
});

test('a made-up language folder is reported but flagged as unofficial', (t) => {
  const game = fakeGame(t, { folders: { dota_123: ['pak10_dir.vpk'] } });
  const [made] = gamelang.langFolders(game);
  assert.equal(made.suffix, '123');
  assert.equal(made.official, false, 'the engine will not mount this one');
});

test('the voice pack is only considered installed when its paks are on disk', (t) => {
  const game = fakeGame(t, {
    folders: { dota_russian: ['pak01_dir.vpk'], dota_german: ['pak10_dir.vpk'] },
  });
  // This is the mechanism behind serving mods from a Russian folder while voices stay
  // English: mount the folder, keep Valve's pak01 out of it.
  assert.equal(gamelang.voiceInstalled(game, 'russian'), true);
  assert.equal(gamelang.voiceInstalled(game, 'german'), false);
  assert.equal(gamelang.voiceInstalled(game, 'koreana'), false);
});

test('writing the languages patches the file and leaves other keys alone', (t) => {
  const game = fakeGame(t, {
    boot: '"boot"\n{\n\t"UILanguage"\t\t"english"\n\t"AudioLanguage"\t\t"english"\n\t"SomethingElse"\t\t"keep me"\n}\n',
  });
  gamelang.writeBootLanguages(game, { ui: 'english', audio: 'russian' });

  const got = gamelang.bootLanguages(game);
  assert.deepEqual(got, { ui: 'english', audio: 'russian' });
  const text = fs.readFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), 'utf-8');
  assert.ok(text.includes('"keep me"'), 'unrelated settings survive');
});

test('writing the languages creates the file when the game never wrote one', (t) => {
  const game = fakeGame(t, {});
  gamelang.writeBootLanguages(game, { ui: 'ru', audio: 'russian' });
  assert.deepEqual(gamelang.bootLanguages(game), { ui: 'ru', audio: 'russian' });
});

// The app sets the audio language and nothing else: the folder it names is where mods have
// to live, while the language somebody reads the game in was their choice long before this.
test('the audio language can be set without touching the text one', (t) => {
  const game = fakeGame(t, {
    boot: '"boot"\n{\n\t"UILanguage"\t\t"koreana"\n\t"AudioLanguage"\t\t"english"\n}\n',
  });
  gamelang.writeBootLanguages(game, { audio: 'russian' });

  assert.deepEqual(gamelang.bootLanguages(game), { ui: 'koreana', audio: 'russian' });
});

test('setting only the audio language on a game that never booted writes just that', (t) => {
  const game = fakeGame(t, {});
  gamelang.writeBootLanguages(game, { audio: 'russian' });

  const text = fs.readFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), 'utf-8');
  assert.ok(!/UILanguage/i.test(text), 'no text language is invented for the user');
  assert.deepEqual(gamelang.bootLanguages(game), { ui: null, audio: 'russian' });
});

test('creating a mod folder mirrors Valve and never overwrites an existing gameinfo', (t) => {
  const game = fakeGame(t, {});

  const dir = gamelang.ensureLangFolder(game, 'russian');
  const gi = path.join(dir, 'gameinfo.gi');
  assert.ok(fs.existsSync(gi));
  const written = fs.readFileSync(gi, 'utf-8');
  assert.match(written, /LayeredOnMod\s+dota/);
  assert.match(written, /Game\s+dota_russian/);
  assert.match(written, /Mod\s+dota_russian/);

  fs.writeFileSync(gi, 'hand edited');
  gamelang.ensureLangFolder(game, 'russian');
  assert.equal(fs.readFileSync(gi, 'utf-8'), 'hand edited', "Valve's own file is left as found");
});

// ---------- English voices with the mods left in place ----------
// The mods live in dota_russian and stay there; what makes the speech Russian is Valve's own
// voice pack inside that folder, so the switch moves the pack out of the mount and nothing else.

/* A Steam root beside the fake game: accounts, their launch options, and who is logged in.
 * `users` is [{ id32, launchOptions, timestamp, mostRecent }]. */
function fakeSteam(game: string, users: { id32: number; launchOptions?: string; timestamp?: number; mostRecent?: boolean }[]) {
  const root = path.resolve(game, '..', '..', '..', '..');
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  const blocks = users.map((u) => {
    const id64 = (BigInt(u.id32) + 76561197960265728n).toString();
    const recent = u.mostRecent ? `\n\t\t"MostRecent"\t\t"1"` : '';
    return `\t"${id64}"\n\t{\n\t\t"Timestamp"\t\t"${u.timestamp || 1}"${recent}\n\t}`;
  });
  fs.writeFileSync(path.join(root, 'config', 'loginusers.vdf'), `"users"\n{\n${blocks.join('\n')}\n}\n`);
  for (const u of users) {
    const dir = path.join(root, 'userdata', String(u.id32), 'config');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'localconfig.vdf'),
      `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"570"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"${u.launchOptions || ''}"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`);
  }
  return root;
}

test('a -language launch option is what decides the folder, over anything the game wrote', (t) => {
  // This is how Minify gets dota_dutch mounted: the parameter locks both language settings and
  // the mount follows it, so reading boot.vcfg alone would name the wrong folder with total
  // confidence - and the user would be told their mods are fine while the game reads elsewhere.
  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  fakeSteam(game, [{ id32: 111, launchOptions: '-novid -language dutch', timestamp: 5 }]);
  const got = gamelang.detectLangSuffix(game);
  assert.equal(got.audio, 'dutch');
  assert.equal(got.source, 'launch');
  assert.equal(got.suffix, null, 'Dutch has no voice pack, so it is not one of the four');
});

/* Exactly what Minify v1.14rc7 leaves behind, escapes and all.
 *
 * It prepends `cmd /c "<its exe>" prelaunch &&` so it can patch before the game starts, and
 * writes the file back with python-vdf, whose writer escapes both the quotes and the
 * backslashes of the path. Reading the value up to the first quote character captured `cmd /c \`
 * and lost the `-language` behind it, so the app decided no parameter was set and installed into
 * the folder named by the voice setting - which the game does not mount while the parameter is
 * there. Every mod invisible, and the app reporting that all was well. */
const RC7_OPTIONS = String.raw`cmd /c \"C:\\Users\\me\\Desktop\\Dota2-Minify\\Dota2-Minify.exe\" prelaunch && %command% -novid -language dutch`;

test('a launch option survives another program putting a quoted path in front of it', (t) => {
  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  fakeSteam(game, [{ id32: 111, launchOptions: RC7_OPTIONS, timestamp: 5 }]);
  assert.equal(gamelang.launchLanguage(game), 'dutch');
  assert.equal(gamelang.detectLangSuffix(game).source, 'launch');
});

test('the whole launch line comes back unescaped, so it can be recognised', (t) => {
  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  fakeSteam(game, [{ id32: 111, launchOptions: RC7_OPTIONS, timestamp: 5 }]);
  const raw = gamelang.launchOptions(game) ?? '';
  assert.match(raw, /^cmd \/c "C:\\Users\\me\\Desktop\\Dota2-Minify\\Dota2-Minify\.exe" prelaunch &&/);
  assert.ok(raw.endsWith('-novid -language dutch'), 'and nothing after the quotes is lost');
});

test('plain options still read the way they always did', (t) => {
  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  fakeSteam(game, [{ id32: 111, launchOptions: '-novid -console -language schinese', timestamp: 5 }]);
  assert.equal(gamelang.launchOptions(game), '-novid -console -language schinese');
  assert.equal(gamelang.launchLanguage(game), 'schinese');
});

test('the account that is logged in is the one whose launch options count', (t) => {
  // Several accounts on one machine is normal, and the others are not ours to read: an option
  // belonging to a sibling account would move mods for somebody who never set it.
  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  fakeSteam(game, [
    { id32: 111, launchOptions: '-novid -console', timestamp: 900 },  // logged in, no language
    { id32: 222, launchOptions: '-language dutch', timestamp: 100 },
  ]);
  assert.equal(gamelang.launchLanguage(game), null);
  assert.equal(gamelang.detectLangSuffix(game).audio, 'russian');
});

test('MostRecent wins over the newest timestamp when Steam writes it', (t) => {
  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  fakeSteam(game, [
    { id32: 111, launchOptions: '-language koreana', timestamp: 900 },
    { id32: 222, launchOptions: '-language schinese', timestamp: 1, mostRecent: true },
  ]);
  assert.equal(gamelang.launchLanguage(game), 'schinese');
});

test('with nobody identifiable, one shared answer is used and a disagreement is not', (t) => {
  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  const root = fakeSteam(game, [
    { id32: 111, launchOptions: '-language dutch', timestamp: 5 },
    { id32: 222, launchOptions: '-language dutch', timestamp: 6 },
  ]);
  fs.rmSync(path.join(root, 'config', 'loginusers.vdf'), { force: true });
  assert.equal(gamelang.launchLanguage(game), 'dutch');

  const game2 = fakeGame(t, { boot: bootFile('russian', 'russian') });
  const root2 = fakeSteam(game2, [
    { id32: 111, launchOptions: '-language dutch', timestamp: 5 },
    { id32: 222, launchOptions: '-language koreana', timestamp: 6 },
  ]);
  fs.rmSync(path.join(root2, 'config', 'loginusers.vdf'), { force: true });
  assert.equal(gamelang.launchLanguage(game2), null, 'two answers is not an answer');
});

test('no Steam layout at all is not an override', (t) => {
  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  assert.equal(gamelang.launchLanguage(game), null);
});

test('an account beside the library that sets no language ends the search there', (t) => {
  /* tools/sandbox.js depends on this. Its library had no Steam account, so on Windows the lookup
   * went on to Program Files\Steam, found the developer's own -language dutch, and a sandbox run
   * installed into dota_dutch while the end-to-end test watched dota_russian. */
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-pf-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fakeSteam(path.join(base, 'Steam', 'steamapps', 'common', 'dota 2 beta', 'game'),
    [{ id32: 222, launchOptions: '-language dutch', mostRecent: true }]);
  process.env['ProgramFiles(x86)'] = base;
  t.after(() => { process.env['ProgramFiles(x86)'] = NO_STEAM; });

  const game = fakeGame(t, { boot: bootFile('russian', 'russian') });
  if (process.platform === 'win32') {
    assert.equal(gamelang.launchLanguage(game), 'dutch', 'with no account of its own the library borrows the default install');
  }
  fakeSteam(game, [{ id32: 111, launchOptions: '', mostRecent: true }]);
  assert.equal(gamelang.launchLanguage(game), null);
});

test('a launch option naming a real language decides the folder, and the app follows it', () => {
  /* `-language X` locks both language settings and the engine builds its content path from it,
   * so a mod anywhere else is invisible however the app sets boot.vcfg. The app used to set the
   * voice language back on every start and lose every time: the user got a folder nobody
   * mounts. Following it is also what lets this share a game with Minify, which is what puts
   * the parameter there. */
  assert.deepEqual(gamelang.modFolderFor('dutch', 'russian'), { suffix: 'dutch', followed: true });
  assert.deepEqual(gamelang.modFolderFor('German', 'russian'), { suffix: 'german', followed: true });
});

test('without a launch option the voice language decides, as before', () => {
  assert.deepEqual(gamelang.modFolderFor(null, 'russian'), { suffix: 'russian', followed: false });
  assert.deepEqual(gamelang.modFolderFor(null, 'koreana'), { suffix: 'koreana', followed: false });
  // English has no folder of its own and borrows the Russian one
  assert.deepEqual(gamelang.modFolderFor(null, 'english'), { suffix: 'russian', followed: false });
});

test('a launch option Dota would not accept is not followed anywhere', () => {
  // the engine mounts a folder only for a language it knows, so following "klingon" would put
  // mods somewhere nothing reads - exactly the failure this is meant to end
  assert.deepEqual(gamelang.modFolderFor('klingon', 'russian'), { suffix: 'russian', followed: false });
  assert.deepEqual(gamelang.modFolderFor('minify', 'russian'), { suffix: 'russian', followed: false });
});

test('a language folder that already exists is not written into', (t) => {
  // dota_dutch is Minify's doing and mounts perfectly well without anything from us; adding a
  // gameinfo.gi to it would be littering in another program's room
  const game = fakeGame(t, { folders: { dota_dutch: ['pak66_dir.vpk'] } });
  gamelang.ensureLangFolder(game, 'dutch');
  assert.equal(fs.existsSync(path.join(game, 'dota_dutch', 'gameinfo.gi')), false);

  // one we create ourselves still gets the stub Valve's own folders carry
  gamelang.ensureLangFolder(game, 'koreana');
  assert.equal(fs.existsSync(path.join(game, 'dota_koreana', 'gameinfo.gi')), true);
});

/* Moving mods when the folder the game mounts changes.
 *
 * This runs at startup, unasked, over files the user installed. Everything it gets wrong is
 * expensive: a mod left behind is invisible, a mod written over is gone, and a file carried off
 * that was never ours belongs to Valve or to another program. Lived in main.js until 2026-09-16,
 * where nothing could test it.
 */
const inFolder = (game: string, suffix: string) => fs.readdirSync(path.join(game, `dota_${suffix}`)).sort();

test('mods follow the folder the game mounts, and the game\'s own files stay where they are', (t) => {
  const game = fakeGame(t, {
    folders: { dota_russian: ['pak10_dir.vpk', 'pak11_dir.vpk', 'pak01_000.vpk', 'gameinfo.gi'] },
  });

  const moved = gamelang.moveLangFolder(game, 'russian', 'koreana');

  assert.equal(moved, 2, 'the count is the mods, not everything in the folder');
  assert.deepEqual(inFolder(game, 'koreana').filter((f) => f !== 'gameinfo.gi'),
    ['pak10_dir.vpk', 'pak11_dir.vpk']);
  assert.deepEqual(inFolder(game, 'russian'), ['gameinfo.gi', 'pak01_000.vpk'],
    'Valve\'s voice pak or the layer definition was carried off');
});

test('another program\'s mods are left where that program put them', (t) => {
  /* Minify writes pak65 to pak67 into whichever language folder it is set to, and sharing one
     folder is the arrangement we tell people to make. Relocating its work would break it
     silently in a folder it is still looking at. */
  const game = fakeGame(t, { folders: { dota_russian: ['pak10_dir.vpk', 'pak66_dir.vpk', 'pak66_000.vpk'] } });

  const moved = gamelang.moveLangFolder(game, 'russian', 'koreana');

  assert.equal(moved, 1);
  assert.deepEqual(inFolder(game, 'russian'), ['pak66_000.vpk', 'pak66_dir.vpk']);
});

test('a mod already in the new folder is not written over by a leftover', (t) => {
  /* Same slot name in both folders means two different mods: the one in the destination is what
     the game is mounting now, and the one being moved is a leftover from a folder it stopped
     reading. Overwriting loses the live one. */
  const game = fakeGame(t, {
    folders: { dota_russian: ['pak10_dir.vpk'], dota_koreana: ['pak10_dir.vpk'] },
  });
  fs.writeFileSync(path.join(game, 'dota_koreana', 'pak10_dir.vpk'), 'the mod in use');
  fs.writeFileSync(path.join(game, 'dota_russian', 'pak10_dir.vpk'), 'the leftover');

  const moved = gamelang.moveLangFolder(game, 'russian', 'koreana');

  assert.equal(moved, 0);
  assert.equal(fs.readFileSync(path.join(game, 'dota_koreana', 'pak10_dir.vpk'), 'utf-8'), 'the mod in use');
  assert.ok(fs.existsSync(path.join(game, 'dota_russian', 'pak10_dir.vpk')), 'the leftover was deleted instead');
});

test('an emptied folder goes away, one that still holds something stays', (t) => {
  const game = fakeGame(t, { folders: { dota_russian: ['pak10_dir.vpk'] } });
  assert.equal(gamelang.moveLangFolder(game, 'russian', 'koreana'), 1);
  assert.equal(fs.existsSync(path.join(game, 'dota_russian')), false);

  const other = fakeGame(t, { folders: { dota_schinese: ['pak10_dir.vpk', 'pak01_dir.vpk'] } });
  assert.equal(gamelang.moveLangFolder(other, 'schinese', 'koreana'), 1);
  assert.deepEqual(inFolder(other, 'schinese'), ['pak01_dir.vpk'], 'a folder with Valve\'s files in it was removed');
});

test('a move with nowhere to go moves nothing', (t) => {
  const game = fakeGame(t, { folders: { dota_russian: ['pak10_dir.vpk'] } });

  assert.equal(gamelang.moveLangFolder(game, 'russian', 'russian'), 0, 'a folder was moved onto itself');
  assert.equal(gamelang.moveLangFolder(game, '', 'koreana'), 0);
  assert.equal(gamelang.moveLangFolder(null, 'russian', 'koreana'), 0);
  assert.equal(gamelang.moveLangFolder(game, 'schinese', 'koreana'), 0, 'a folder that is not there');
  assert.deepEqual(inFolder(game, 'russian'), ['pak10_dir.vpk'], 'the folder was touched anyway');

  /* The same folder twice, with nothing in it, is the case that actually bites. Every file is
     already at its destination because the destination IS the source, so the loop moves nothing
     and reports nothing wrong - and then finds the folder empty and removes it. That is the
     folder the game is mounting. Only the guard at the top stops it. */
  const empty = fakeGame(t, { folders: { dota_russian: [] } });
  assert.equal(gamelang.moveLangFolder(empty, 'russian', 'russian'), 0);
  assert.ok(fs.existsSync(path.join(empty, 'dota_russian')), 'the folder the game mounts was removed');
});

test('a gameinfo another program writes just before ours is not written over', (t) => {
  /* CodeQL js/file-system-race (#115): looking for gameinfo.gi and writing it were two calls, so
     a file another program put there in between was replaced by our stub. The write itself now
     refuses a file that exists. Here the other program always wins that gap. */
  const game = fakeGame(t, {});
  const theirs = 'written by another program';
  const realWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, opts?: fs.WriteFileOptions) => {
    if (path.basename(String(file)) === 'gameinfo.gi' && data !== theirs) realWrite(file, theirs);
    return realWrite(file, data, opts);
  });

  const dir = gamelang.ensureLangFolder(game, 'russian');
  assert.equal(fs.readFileSync(path.join(dir, 'gameinfo.gi'), 'utf-8'), theirs);
});

test('a gameinfo that cannot be written is still an error, not taken for one already there', (t) => {
  const game = fakeGame(t, {});
  const realWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, opts?: fs.WriteFileOptions) => {
    if (path.basename(String(file)) === 'gameinfo.gi') throw Object.assign(new Error('access denied'), { code: 'EACCES' });
    return realWrite(file, data, opts);
  });
  assert.throws(() => gamelang.ensureLangFolder(game, 'russian'), /access denied/);
});
