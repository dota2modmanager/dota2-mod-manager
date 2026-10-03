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
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';
import { MARKER, searchPathsBlock, withModFolder, patchedBranch, restoreBranch } from './patcher-gameinfo.ts';
import { signatureLine, vanillaBranchHashes, matchesVanilla, hasSignaturePatch, stripSignatures } from './patcher-signatures.ts';

/** The content folder registered next to the game's own "dota". */
export const FOLDER = 'dota_mods';
const BIN_DIRS: Record<'win32' | 'linux', string[]> = { win32: ['bin', 'win64'], linux: ['bin', 'linuxsteamrt64'] };

// Folder names other patchers register, so we can spot one and not fight it.
const KNOWN_FOREIGN = ['Dota2SkinChanger', 'DotaModdingCommunityMods', 'dota_tempcontent'];

/** What the install looks like right now; see state(). */
export interface PatchState {
  patched: boolean; signed: boolean; signable: boolean;
  /** our folder, when the patch is in */
  folder: string | null;
  /** another patcher's folder found registered beside ours */
  foreign: string | null;
  /** unpatched and exactly what Valve shipped, or no list to say otherwise */
  vanillaOk: boolean;
}

/** The three files the patch touches, for this platform's layout of the game. */
export function paths(gamePath: string): { gameinfo: string; branch: string; signatures: string } {
  const bin = BIN_DIRS[process.platform === 'linux' ? 'linux' : 'win32'];
  return {
    gameinfo: path.join(gamePath, 'dota', 'gameinfo.gi'),
    branch: path.join(gamePath, 'dota', 'gameinfo_branchspecific.gi'),
    signatures: path.join(gamePath, ...bin, 'dota.signatures'),
  };
}

/**
 * What the install looks like right now.
 *
 * `signable` says whether this installation has a signature list at all. Valve's Linux build
 * ships no `dota.signatures`, so on Linux there is nothing to sign the patch into and nothing
 * to check it against - which is not the same as an unsigned patch, and callers have to tell
 * the two apart or a Linux user gets a permanent warning about a file that was never there.
 *
 */
export function state(gamePath: string, folder: string | null): PatchState {
  const p = paths(gamePath);
  const out: PatchState = { patched: false, signed: false, signable: false, folder: null, foreign: null, vanillaOk: true };
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
function backupOnce(file: string, backupDir: string, clean: (text: string) => string, isOurs: (text: string) => boolean, isGood?: (text: string) => boolean): string {
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
function writeAtomic(file: string, buf: Buffer): void {
  const tmp = file + '.mmtmp';
  fs.writeFileSync(tmp, buf);
  try {
    fs.renameSync(tmp, file);
    return;
  } catch (e) {
    if (!['EPERM', 'EACCES', 'EEXIST', 'EBUSY'].includes((e as NodeJS.ErrnoException).code || '')) { fs.rmSync(tmp, { force: true }); throw e; }
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
export function apply({ gamePath, folder, backupDir }: { gamePath: string; folder: string; backupDir: string }): PatchState {
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
  const good = (text: string) => matchesVanilla(restoreBranch(text, want).text, want);
  backupOnce(p.branch, backupDir, (text) => restoreBranch(text, want).text, (text) => text.includes(MARKER), good);
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
export function revert({ gamePath, folder, backupDir }: { gamePath: string; folder?: string | null; backupDir: string }): PatchState {
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
  return state(gamePath, folder || null);
}

// The text work is kept as two files: src/patcher-gameinfo.ts for the gameinfo files and
// src/patcher-signatures.ts for the signature list. Callers import from here.
export { MARKER, searchPathsBlock, withModFolder, patchedBranch, stripPatch, restoreBranch } from './patcher-gameinfo.ts';
export { crc32, fileHashes, signatureLine, vanillaBranchHashes, matchesVanilla, hasSignaturePatch, stripSignatures } from './patcher-signatures.ts';
export type { Hashes } from './patcher-signatures.ts';
