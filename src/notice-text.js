/* The game's anti-cheat notice, in words that say what to do.
 *
 * When Dota cannot verify the game before matchmaking it says "Valve Anti-Cheat was unable to
 * verify that your machine is secure", and a player with mods reads that as a ban on the way.
 * It is not one: the usual cause is a damaged install or a Steam that needs a restart. The app
 * replaces the four strings of that window with src/notice-texts.ts, in the language the game
 * shows, and names the one switch that takes every mod out.
 *
 * How: a localization file in the language folder the game mounts, inside the app's own pak
 * (APP_PAK, src/slot-zones.js). Measured on a live game on 2026-09-25: the engine reads its
 * localization by a fixed list of names and ignores any other, and chat_<lang>.txt is read after
 * dota_<lang>.txt, so a string defined in it replaces the one Valve ships. So the pak carries the
 * chat file the game would have read anyway, with the four strings added at the end.
 *
 * The pak is not a mod. It is never listed, switched off by the master switch or counted as a
 * slot, so nobody turns the notice back into Valve's words by accident. It is rebuilt when the
 * game, its language or a pak in that folder changes, removed by the uninstaller, and left
 * alone when somebody else's file already holds its name.
 */
const fs = require('fs');
const path = require('path');

const vpk = require('./vpk.ts');
const gamelang = require('./gamelang.ts');
const { APP_PAK } = require('./slot-zones');
const { NOTICE_TEXTS, NOTICE_KEYS } = require('./notice-texts.ts');

/** The file name of the app's pak in the language folder. */
const NOTICE_PAK = `pak${APP_PAK}_dir.vpk`;
/** An entry that marks the pak as ours: a pak64 without it belongs to somebody else. */
const MARKER = 'dota2modmanager/notice.json';
const MARKER_BODY = Buffer.from(JSON.stringify({
  app: 'Dota 2 Mod Manager',
  url: 'https://dota2modmanager.com',
  note: 'Clearer text for the game\'s anti-cheat notice. Not a mod: the app keeps it up to date and its uninstaller removes it.',
}, null, 2));

const localization = (name, lang) => `resource/localization/${name}_${lang}.txt`;

/** The language the game shows its interface in: a launch option, then its own setting, then Steam's. */
function uiLanguage(gamePath) {
  const lang = gamelang.launchLanguage(gamePath) || gamelang.bootLanguages(gamePath)?.ui || gamelang.steamLanguage(gamePath) || 'english';
  return String(lang).toLowerCase();
}

/** The `"Language"` a localization file declares, lowercased, or null. */
function declaredLanguage(text) {
  const m = /"Language"\s+"([^"]+)"/i.exec(text.slice(0, 512));
  return m ? m[1].toLowerCase() : null;
}

/**
 * The four strings, in the language a player will see them in. That is the language the
 * winning dota_<lang>.txt declares rather than the setting's name: Minify's "English fix" puts
 * English files under the Dutch names, and a Dutch notice in an English game would be the odd
 * one out.
 */
function textsFor(language, ui) {
  return NOTICE_TEXTS[language] || NOTICE_TEXTS[ui] || NOTICE_TEXTS.english;
}

/**
 * A localization file with our strings at the end of its Tokens block, in the file's own line
 * ending. Any earlier definition of the same keys is taken out first, so the file says each
 * thing once. Returns null for a file with no Tokens block, which is not one to build on.
 * @param {string} text
 * @param {Record<string, string>} tokens  key -> value, no double quotes in either
 */
function withTokens(text, tokens) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let out = text;
  for (const key of Object.keys(tokens)) {
    out = out.replace(new RegExp(`^[ \\t]*"${key}"[ \\t]+"(?:[^"\\\\\\r\\n]|\\\\.)*"[^\\r\\n]*\\r?\\n`, 'gim'), '');
  }
  // Walk the file: quoted strings are skipped whole, so a brace inside a value counts for
  // nothing, and the brace that closes the block opened after "Tokens" is where ours go.
  let depth = 0;
  let tokensDepth = -1;
  let last = null;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c === '"') {
      let j = i + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      last = out.slice(i + 1, j);
      i = j;
    } else if (c === '/' && out[i + 1] === '/') {
      while (i < out.length && out[i] !== '\n') i++;
    } else if (c === '{') {
      depth++;
      if (tokensDepth < 0 && last && last.toLowerCase() === 'tokens') tokensDepth = depth;
      last = null;
    } else if (c === '}') {
      if (depth === tokensDepth) {
        const before = out.slice(0, i);
        const lines = Object.entries(tokens).map(([k, v]) => `"${k}"\t"${v}"${eol}`).join('');
        return `${before}${before.endsWith('\n') ? '' : eol}${lines}${out.slice(i)}`;
      }
      depth--;
    }
  }
  return null;
}

/** One file for buildVpk. */
function entryFor(relPath, data) {
  const slash = relPath.lastIndexOf('/');
  const file = relPath.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return { ext: file.slice(dot + 1), folder: relPath.slice(0, slash), name: file.slice(0, dot), data, preload: Buffer.alloc(0), crc: vpk.crc32(data) };
}

/** The live paks of a language folder other than ours, in the order the game reads them. */
function livePaks(langDir) {
  let names = [];
  try { names = fs.readdirSync(langDir); } catch { return []; }
  return names
    .map((f) => ({ f, m: /^pak(\d+)_dir\.vpk$/i.exec(f) }))
    .filter((x) => x.m && Number(x.m[1]) !== APP_PAK)
    .map((x) => ({ file: path.join(langDir, x.f), n: Number(x.m[1]) }))
    .sort((a, b) => a.n - b.n);
}

/** Whether the pak at `file` is ours, by its marker. */
function isOurs(file) {
  try { return vpk.openVpkIndex(file).has(MARKER); } catch { return false; }
}

/**
 * What the language folder should hold, worked out from the game as it is.
 * @returns {{ action: 'write', bytes: Buffer, language: string }
 *   | { action: 'remove', why: string } | { action: 'skip', why: string }}
 */
function plan({ gamePath, langDir }) {
  const target = path.join(langDir, NOTICE_PAK);
  if (fs.existsSync(target) && !isOurs(target)) return { action: 'skip', why: `${NOTICE_PAK} is somebody else's` };
  const ui = uiLanguage(gamePath);
  const chatRel = localization('chat', ui);
  const dotaRel = localization('dota', ui);
  const paks = livePaks(langDir).map((p) => {
    try { return { ...p, index: vpk.openVpkIndex(p.file) }; } catch { return null; }
  }).filter(Boolean);
  // A pak read before ours that carries the same file wins over it: nothing to add then.
  const ahead = paks.find((p) => p.n < APP_PAK && p.index.has(chatRel));
  if (ahead) return { action: 'remove', why: `${path.basename(ahead.file)} carries ${chatRel}` };

  let chat = paks.find((p) => p.index.has(chatRel))?.index.read(chatRel) || null;
  if (!chat) {
    const valve = path.join(gamePath, 'dota', 'pak01_dir.vpk');
    try { chat = vpk.openVpkIndex(valve).read(chatRel); } catch { chat = null; }
  }
  if (!chat) return { action: 'remove', why: `the game has no ${chatRel}` };

  const main = paks.find((p) => p.index.has(dotaRel));
  const language = (main && declaredLanguage(main.index.read(dotaRel).toString('utf8'))) || ui;
  const texts = textsFor(language, ui);
  const tokens = Object.fromEntries(Object.entries(NOTICE_KEYS).map(([what, key]) => [key, texts[what]]));
  const text = withTokens(chat.toString('utf8'), tokens);
  if (text === null) return { action: 'remove', why: `${chatRel} has no Tokens block` };
  const bytes = vpk.buildVpk([entryFor(chatRel, Buffer.from(text, 'utf8')), entryFor(MARKER, MARKER_BODY)]);
  return { action: 'write', bytes, language };
}

/** Take the pak out of a language folder, if it is ours. */
function removeNotice(langDir) {
  const target = path.join(langDir, NOTICE_PAK);
  if (!fs.existsSync(target) || !isOurs(target)) return false;
  fs.rmSync(target, { force: true });
  return true;
}

/**
 * Bring the language folder in line with the plan. Writes only when the bytes differ, and
 * through a temporary name, so the game never meets half a file. A pak the running game holds
 * open cannot be replaced: that is an error the caller logs, and the next refresh tries again.
 * @returns {string} what happened, for the log
 */
function applyNotice({ gamePath, langDir }) {
  if (!gamePath || !langDir || !fs.existsSync(langDir)) return 'no language folder';
  const p = plan({ gamePath, langDir });
  if (p.action === 'skip') return `skipped: ${p.why}`;
  if (p.action === 'remove') return removeNotice(langDir) ? `removed: ${p.why}` : `not needed: ${p.why}`;
  const target = path.join(langDir, NOTICE_PAK);
  let current = null;
  try { current = fs.readFileSync(target); } catch { /* not written yet */ }
  if (current && current.equals(p.bytes)) return `up to date (${p.language})`;
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, p.bytes);
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return `written (${p.language})`;
}

/**
 * The notice kept current from a place that runs often. Rebuilding reads the game's 23 MB index,
 * so it only happens when something it depends on changed: the game's settings, its main pak,
 * or any pak in the language folder.
 * @param {{ gamePath: () => string|null, langDir: () => string, diag: (msg: string) => void, retryMs?: number }} ctx
 */
function createNoticeText({ gamePath, langDir, diag, retryMs = 60_000 }) {
  let lastKey = null;
  let failedAt = 0;
  const stamp = (file) => {
    try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; }
  };
  const keyOf = (game, dir) => {
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => /^pak\d+_dir\.vpk$/i.test(f)).sort(); } catch { /* no folder */ }
    return [
      game, dir, uiLanguage(game),
      stamp(path.join(game, 'dota', 'pak01_dir.vpk')),
      ...names.map((f) => `${f}=${stamp(path.join(dir, f))}`),
    ].join('|');
  };
  return {
    /**
     * Check, and rebuild when something changed. Never throws. A failed write (the running
     * game holds the pak open) is tried again once a minute, not on every call.
     * @returns {string|null} what happened, or null when nothing needed doing
     */
    refresh() {
      try {
        const game = gamePath();
        if (!game) return null;
        const dir = langDir();
        const key = keyOf(game, dir);
        if (key === lastKey && !(failedAt && Date.now() - failedAt >= retryMs)) return null;
        lastKey = key;
        const result = applyNotice({ gamePath: game, langDir: dir });
        // what was just written changes the key; take it from after the write
        lastKey = keyOf(game, dir);
        failedAt = 0;
        diag(`notice text: ${result}`);
        return result;
      } catch (err) {
        failedAt = Date.now();
        diag(`notice text skipped: ${err.message}`);
        return `failed: ${err.message}`;
      }
    },
    /** The pak's relPath when the folder holds ours, for the note of files that are ours. */
    ownedFiles() {
      try { return isOurs(path.join(langDir(), NOTICE_PAK)) ? [NOTICE_PAK] : []; } catch { return []; }
    },
  };
}

module.exports = {
  NOTICE_PAK, MARKER, uiLanguage, declaredLanguage, withTokens, plan, removeNotice, applyNotice, createNoticeText,
};
