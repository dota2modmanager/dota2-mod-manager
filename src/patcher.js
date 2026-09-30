// Search-path patch: registers an extra content folder ahead of the game's own, which
// is the only way to override files the engine reads through the MOD path id -
// scripts/items/items_game.txt above all. Mods in a language folder can replace any
// ordinary asset, but never the item schema: MOD resolves to game/dota alone.
//
// Mechanics (same shape the community patchers use, rebuilt from the local files):
//   game/dota/gameinfo_branchspecific.gi  gets a FileSystem/SearchPaths block whose
//     content is derived from the CURRENT gameinfo.gi plus our folder, so a Valve
//     change to the search paths is carried over instead of silently dropped;
//   game/bin/win64/dota.signatures        gets a line with the patched file's SHA1+CRC,
//     because the client checks that file against the signature list.
//
// Everything is backed up before the first write and revert() puts the originals back.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { t } = require('./i18n.ts');

const MARKER = 'Dota 2 Mod Manager';
// Content folder we register next to the game's own "dota".
const FOLDER = 'dota_mods';
const BIN_DIRS = { win32: ['bin', 'win64'], linux: ['bin', 'linuxsteamrt64'] };
const SIG_PREFIX = '...\\..\\..\\dota\\gameinfo_branchspecific.gi';

// Folder names other patchers register, so we can spot one and not fight it.
const KNOWN_FOREIGN = ['Dota2SkinChanger', 'DotaModdingCommunityMods', 'dota_tempcontent'];

function paths(gamePath) {
  const bin = BIN_DIRS[process.platform === 'linux' ? 'linux' : 'win32'];
  return {
    gameinfo: path.join(gamePath, 'dota', 'gameinfo.gi'),
    branch: path.join(gamePath, 'dota', 'gameinfo_branchspecific.gi'),
    signatures: path.join(gamePath, ...bin, 'dota.signatures'),
  };
}

/** @type {Uint32Array|null} built on the first call */
let crcTable = null;

function crc32(buf) {
  let table = crcTable;
  if (!table) {
    table = crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The signature list stores the CRC little-endian, uppercase, like the SHA1 next to it.
function fileHashes(buf) {
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex').toUpperCase();
  const le = Buffer.alloc(4);
  le.writeUInt32LE(crc32(buf));
  return { sha1, crc: le.toString('hex').toUpperCase() };
}

function signatureLine(buf) {
  const { sha1, crc } = fileHashes(buf);
  return `${SIG_PREFIX}~SHA1:${sha1};CRC:${crc}`;
}

// Pull the SearchPaths block out of gameinfo.gi (branchspecific has none by default).
function searchPathsBlock(gameinfoText) {
  const at = gameinfoText.indexOf('SearchPaths');
  if (at === -1) throw new Error(t('gameinfo.gi: блок SearchPaths не найден'));
  const open = gameinfoText.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < gameinfoText.length; i++) {
    if (gameinfoText[i] === '{') depth++;
    else if (gameinfoText[i] === '}') { depth--; if (!depth) return gameinfoText.slice(at, i + 1); }
  }
  throw new Error(t('gameinfo.gi: блок SearchPaths не закрыт'));
}

/**
 * Add our folder to a SearchPaths block: as the first Game path (which is also what the
 * engine turns into the MOD path) and as the first Mod path.
 */
function withModFolder(block, folder) {
  const lines = block.split(/\r?\n/);
  const out = [];
  let addedGame = false;
  let addedMod = false;
  for (const line of lines) {
    const game = /^(\s*)Game(\s+)dota\s*$/.exec(line);
    if (game && !addedGame) {
      out.push(`${game[1]}Game${game[2]}${folder}\t\t// ${MARKER}`);
      addedGame = true;
    }
    const mod = /^(\s*)Mod(\s+)dota\s*$/.exec(line);
    if (mod && !addedMod) {
      out.push(`${mod[1]}Mod${mod[2]}${folder}\t\t// ${MARKER}`);
      addedMod = true;
    }
    out.push(line);
  }
  if (!addedGame || !addedMod) throw new Error(t('gameinfo.gi: не найдены строки Game/Mod dota'));
  return out.join('\r\n');
}

// Put the block inside branchspecific's FileSystem section (its keys win over gameinfo.gi).
function patchedBranch(branchText, block) {
  const at = branchText.indexOf('FileSystem');
  if (at === -1) throw new Error(t('gameinfo_branchspecific.gi: блок FileSystem не найден'));
  const open = branchText.indexOf('{', at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < branchText.length; i++) {
    if (branchText[i] === '{') depth++;
    else if (branchText[i] === '}') { depth--; if (!depth) { close = i; break; } }
  }
  if (close === -1) throw new Error(t('gameinfo_branchspecific.gi: блок FileSystem не закрыт'));
  // The original file ends its FileSystem body with a lone indent tab meant for its closing
  // brace ("...\r\n\t}") - strip it before splicing in our own block, or the two indents stack
  // into a stray extra tab ahead of "SearchPaths".
  const head = branchText.slice(0, close).replace(/[ \t]+$/, '');
  const indented = block.split(/\r?\n/).map((l) => (l.trim() ? '\t\t' + l.trim() : l)).join('\r\n');
  return head + indented + '\r\n\t' + branchText.slice(close);
}

/**
 * Undo our own insertion in a gameinfo file, byte for byte.
 *
 * patchedBranch() writes <body> + "\t\t" + <SearchPaths block> + "\r\n\t" + "}", having
 * first stripped the indent the original had before that closing brace. The inverse has to
 * put that indent back, so the whitespace on BOTH sides of the block is taken out and the
 * one shape the original always has - "\r\n\t" before the closing brace - is written in its
 * place. Cutting only the block and the whitespace after it (what this used to do) returned
 * a file one tab shorter than the one Valve shipped: close enough to load, but no longer
 * matching the hash the client checks it against, which is what stops matchmaking.
 *
 * Used wherever a patched file could be mistaken for an original: a backup taken while the
 * patch was already applied would otherwise be useless, and telling the user to go repair
 * game files by hand is not an answer the app is allowed to give.
 */
function stripPatch(text) {
  let out = text;
  for (let guard = 0; guard < 8 && out.includes(MARKER); guard++) {
    const mark = out.indexOf(MARKER);
    const kw = out.lastIndexOf('SearchPaths', mark);
    if (kw === -1) break;
    const open = out.indexOf('{', kw);
    if (open === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    if (end === -1) break;
    let start = kw;
    while (start > 0 && /[ \t\r\n]/.test(out[start - 1])) start--;
    while (end < out.length && /[ \t\r\n]/.test(out[end])) end++;
    // the block always sits at the end of the FileSystem body, so what follows is that
    // body's closing brace and the indent it wants is a single tab
    const joiner = out[end] === '}' ? '\r\n\t' : '\r\n';
    out = out.slice(0, start) + joiner + out.slice(end);
  }
  return out;
}

/**
 * Valve's own recorded hash for the file we edit, read out of the signature list the game
 * ships with. Ground truth: whatever we put back has to hash to this, or the client refuses
 * the install ("verify integrity of game files") and matchmaking stops. Their entry sits
 * BEFORE the DIGEST line - ours, when present, is appended after it.
 * @returns {{sha1: string, crc: string} | null}
 */
function vanillaBranchHashes(signaturesText) {
  const lines = signaturesText.split(/\r?\n/);
  const digest = lines.findIndex((l) => l.startsWith('DIGEST:'));
  const scope = digest === -1 ? lines : lines.slice(0, digest);
  for (const l of scope) {
    const m = /gameinfo_branchspecific\.gi~SHA1:([0-9A-Fa-f]{40});CRC:([0-9A-Fa-f]{8})\s*$/.exec(l);
    if (m) return { sha1: m[1].toUpperCase(), crc: m[2].toUpperCase() };
  }
  return null;
}

function matchesVanilla(text, want) {
  if (!want) return true; // no list to check against - nothing to contradict
  const h = fileHashes(Buffer.from(text, 'latin1'));
  return h.sha1 === want.sha1 && h.crc === want.crc;
}

/**
 * The original branchspecific file, reconstructed and CHECKED against Valve's own list
 * rather than trusted. A copy this app made in an older version can be a tab short of the
 * real thing, and a wrong copy is worse than none: it loads, so nothing looks broken until
 * the client quietly stops finding matches. The only thing a reconstruction can get wrong
 * is the indent ahead of the FileSystem closing brace, so when the hash disagrees the few
 * shapes that indent can take are tried and the one Valve signed is kept.
 * @returns {{ text: string, verified: boolean }}
 */
function restoreBranch(text, want) {
  const base = stripPatch(text);
  if (matchesVanilla(base, want)) return { text: base, verified: !!want };
  const at = base.lastIndexOf('\n', base.lastIndexOf('}', base.lastIndexOf('}') - 1));
  if (at !== -1) {
    let end = at + 1;
    while (end < base.length && /[ \t]/.test(base[end])) end++;
    for (const indent of ['\t', '', '\t\t']) {
      const candidate = base.slice(0, at + 1) + indent + base.slice(end);
      if (matchesVanilla(candidate, want)) return { text: candidate, verified: true };
    }
  }
  return { text: base, verified: false };
}

/**
 * Is our line present in a signature list? Valve's own pristine file ALREADY carries an
 * entry for gameinfo_branchspecific.gi (before DIGEST, with the vanilla hash), so merely
 * finding the path proves nothing - only an entry appended AFTER the DIGEST line is ours.
 * Getting this wrong makes a pristine list look patched, which freezes the backup at a
 * pre-update build and lets apply() write those stale hashes over the live file.
 */
function hasSignaturePatch(text) {
  const lines = text.split(/\r?\n/);
  const digest = lines.findIndex((l) => l.startsWith('DIGEST:'));
  if (digest === -1) return false;
  return lines.slice(digest + 1).some((l) => l.startsWith(SIG_PREFIX + '~'));
}

// Same for the signature list: our line is appended after the DIGEST line, so anything of
// ours past that point comes off and the file the game shipped is left behind.
function stripSignatures(text) {
  const lines = text.split(/\r?\n/);
  const digest = lines.findIndex((l) => l.startsWith('DIGEST:'));
  if (digest === -1) return text;
  const kept = lines.filter((l, i) => i <= digest || !l.startsWith(SIG_PREFIX + '~'));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.join('\r\n') + '\r\n';
}

/**
 * What the install looks like right now.
 *
 * `signable` says whether this installation has a signature list at all. Valve's Linux build
 * ships no `dota.signatures`, so on Linux there is nothing to sign the patch into and nothing
 * to check it against - which is not the same as an unsigned patch, and callers have to tell
 * the two apart or a Linux user gets a permanent warning about a file that was never there.
 *
 * @returns {{ patched: boolean, signed: boolean, signable: boolean, folder: string|null, foreign: string|null, vanillaOk: boolean }}
 */
function state(gamePath, folder) {
  const p = paths(gamePath);
  const out = { patched: false, signed: false, signable: false, folder: null, foreign: null, vanillaOk: true };
  if (!fs.existsSync(p.branch)) return out;
  out.signable = fs.existsSync(p.signatures);
  const branch = fs.readFileSync(p.branch, 'latin1');
  if (branch.includes(MARKER)) {
    out.patched = true;
    out.folder = folder;
  }
  for (const name of KNOWN_FOREIGN) {
    if (new RegExp(`^\\s*(Game|Mod)\\s+${name}\\s*$`, 'm').test(branch)) out.foreign = name;
  }
  // Without a list there is nothing to sign into and nothing to compare against. The patch
  // itself is the whole job on such an install.
  if (!out.signable) return out;
  const sigText = fs.readFileSync(p.signatures, 'latin1');
  if (out.patched) {
    const want = signatureLine(fs.readFileSync(p.branch));
    out.signed = sigText.split(/\r?\n/).some((l) => l.trim() === want);
  } else {
    // Not patched means the file must be exactly what Valve shipped. If it is not, the
    // client will refuse the install even though this app is doing nothing right now -
    // worth knowing, because "turning the patch off broke my game" reads as our fault
    // and the only cure is Steam's own file check.
    out.vanillaOk = matchesVanilla(branch, vanillaBranchHashes(sigText));
  }
  return out;
}

// Store the pristine file. A Dota update overwrites the game's copy with a fresh vanilla
// build before heal() re-patches it - that moment is the only time we ever see the new
// ground truth, so a file with no trace of our own edit always replaces whatever backup we
// are holding (an old backup is what makes revert() write files Steam's current build no
// longer recognises - "verify integrity of game files" territory). Once our edit is present,
// the existing backup is left alone; if none exists yet it is reconstructed via clean() (a
// backup lost between runs, a second tool, a crash mid-write) so the user has nothing to fix
// by hand.
function backupOnce(file, backupDir, clean, isOurs, isGood) {
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, path.basename(file) + '.orig');
  const raw = fs.readFileSync(file, 'latin1');
  // A copy we hold that does not match what the game says the original is buys nothing -
  // it is the thing that would be restored later, so it gets replaced even though a backup
  // already exists. Without this check one bad reconstruction sticks around forever.
  const stale = isGood && fs.existsSync(dest) && !isGood(fs.readFileSync(dest, 'latin1'));
  if (!isOurs(raw)) {
    fs.writeFileSync(dest, Buffer.from(raw, 'latin1'));
  } else if (!fs.existsSync(dest) || stale) {
    fs.writeFileSync(dest, Buffer.from(clean(raw), 'latin1'));
  }
  return dest;
}

// Write via a temp file + rename: a half-written gameinfo means the game will not start.
// Windows refuses to rename over a file another process has open (Steam holds gameinfo
// while the app is up), so fall back to replacing the target in place.
function writeAtomic(file, buf) {
  const tmp = file + '.mmtmp';
  fs.writeFileSync(tmp, buf);
  try {
    fs.renameSync(tmp, file);
    return;
  } catch (e) {
    if (!['EPERM', 'EACCES', 'EEXIST', 'EBUSY'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
  }
  try {
    fs.rmSync(file, { force: true });
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, buf);
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Register the folder. Safe to call repeatedly: it rebuilds the patch from the current
 * vanilla files (restoring the backup first), so a game update just means running it again.
 */
function apply({ gamePath, folder, backupDir }) {
  const p = paths(gamePath);
  /* The two files every Dota install has. `dota.signatures` is not one of them: Valve's Linux
     build ships `bin/linuxsteamrt64/` without it, and requiring it here meant a Linux user
     pressing "safe mode off" got "dota.signatures not found" and no way forward. Reported with
     a photo of that folder, which has the client, forty shared libraries and no list. */
  for (const f of [p.gameinfo, p.branch]) {
    if (!fs.existsSync(f)) throw new Error(t('Не найден {0}', f));
  }
  const hasList = fs.existsSync(p.signatures);
  const want = hasList ? vanillaBranchHashes(fs.readFileSync(p.signatures, 'latin1')) : null;
  const good = (text) => matchesVanilla(restoreBranch(text, want).text, want);
  backupOnce(p.branch, backupDir, (t) => restoreBranch(t, want).text, (t) => t.includes(MARKER), good);
  if (hasList) backupOnce(p.signatures, backupDir, stripSignatures, hasSignaturePatch);

  // Always start from the pristine copies so patches never stack. A backup that somehow
  // carries our edit is cleaned rather than refused - the user has nothing to fix by hand.
  const branchOrig = restoreBranch(fs.readFileSync(path.join(backupDir, path.basename(p.branch) + '.orig'), 'latin1'), want).text;

  const block = withModFolder(searchPathsBlock(fs.readFileSync(p.gameinfo, 'latin1')), folder);
  const branchBuf = Buffer.from(patchedBranch(branchOrig, block), 'latin1');
  writeAtomic(p.branch, branchBuf);

  if (hasList) {
    /* From the list the game has right now, never from the backup.
     *
     * Valve ships a new dota.signatures with every build: the hash of every DLL the client
     * checks, and a DIGEST over the lot. Ours is one line appended after that DIGEST, and
     * stripSignatures takes off exactly that much - so the current file minus our line is, by
     * construction, the list this build shipped.
     *
     * Building it from the backup instead put an older build's hashes back. On a real
     * installation on 2026-09-11 that backup was from 29 July: it named
     * dota2.exe~SHA1:0A281119 where the game's own list said 72ED2906, so the client compared
     * its real binaries against six-week-old hashes and refused matchmaking. The app reported
     * patched, signed and vanilla throughout, because nothing here ever looked at the rest of
     * the list - only at whether our own line was in it.
     *
     * The backup is still written, and revert() still falls back to it, but nothing builds
     * from it any more: a copy of a file that changes every patch cannot be the ground truth
     * for the patch after it.
     */
    const sigOrig = stripSignatures(fs.readFileSync(p.signatures, 'latin1'));
    const line = signatureLine(branchBuf);
    writeAtomic(p.signatures, Buffer.from(sigOrig.replace(/\s+$/, '') + '\r\n' + line + '\r\n', 'latin1'));
  }

  fs.mkdirSync(path.join(gamePath, folder), { recursive: true });
  return state(gamePath, folder);
}

/**
 * Put the originals back and drop the folder if it is empty.
 *
 * The signature list is restored first, so the hashes Valve recorded are on disk before the
 * file they describe is written - and so the check below reads this build's list, not a
 * leftover from an earlier one. What goes back in place of the patched file is verified
 * against that list rather than taken on faith: this is the moment the game becomes vanilla
 * again, and a copy that is even one byte off leaves the client refusing to matchmake with
 * no mod in sight to blame.
 */
function revert({ gamePath, folder, backupDir }) {
  const p = paths(gamePath);
  /* Same reasoning as apply(): what Valve shipped is the file the game has now, minus our line.
     The backup is the fallback for the one case the live file cannot answer - it is not there. */
  const sigSrc = path.join(backupDir, path.basename(p.signatures) + '.orig');
  const sigNow = fs.existsSync(p.signatures) ? p.signatures : (fs.existsSync(sigSrc) ? sigSrc : null);
  if (sigNow) {
    writeAtomic(p.signatures, Buffer.from(stripSignatures(fs.readFileSync(sigNow, 'latin1')), 'latin1'));
  }
  const branchSrc = path.join(backupDir, path.basename(p.branch) + '.orig');
  if (fs.existsSync(branchSrc)) {
    const want = fs.existsSync(p.signatures) ? vanillaBranchHashes(fs.readFileSync(p.signatures, 'latin1')) : null;
    const { text } = restoreBranch(fs.readFileSync(branchSrc, 'latin1'), want);
    writeAtomic(p.branch, Buffer.from(text, 'latin1'));
  }
  if (folder) {
    const dir = path.join(gamePath, folder);
    if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  }
  return state(gamePath, folder);
}

module.exports = {
  MARKER,
  FOLDER,
  paths,
  fileHashes,
  signatureLine,
  searchPathsBlock,
  withModFolder,
  patchedBranch,
  stripPatch,
  stripSignatures,
  hasSignaturePatch,
  vanillaBranchHashes,
  matchesVanilla,
  restoreBranch,
  state,
  apply,
  revert,
  crc32,
};
