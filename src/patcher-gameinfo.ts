// The two gameinfo files (src/patcher.ts explains the patch): the SearchPaths block read out of
// gameinfo.gi with our folder added, that block spliced into gameinfo_branchspecific.gi, and the
// same file taken back to what Valve shipped, byte for byte.
import { t } from './i18n.ts';
import { matchesVanilla, type Hashes } from './patcher-signatures.ts';

/** Written beside every line this app adds, so its own edit can be found and taken out again. */
export const MARKER = 'Dota 2 Mod Manager';

/** Pull the SearchPaths block out of gameinfo.gi (branchspecific has none by default). */
export function searchPathsBlock(gameinfoText: string): string {
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
export function withModFolder(block: string, folder: string): string {
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
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

/**
 * The lines of a SearchPaths block the engine acts on: comments and blank lines dropped,
 * whitespace inside a line collapsed. Two blocks with the same lines mount the same folders.
 */
export function searchPathLines(block: string): string[] {
  return block.split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, '').trim().replace(/\s+/g, ' '))
    .filter((l) => l && l !== 'SearchPaths' && l !== '{' && l !== '}');
}

/**
 * Whether the search paths our patch put in the branch file are still the ones the game's
 * current gameinfo.gi gives, plus our folder.
 *
 * The block is a copy, and a copy goes stale. Steam updates only the files a build changed, and
 * Valve has not touched gameinfo_branchspecific.gi since 2025, so a patch written before an
 * update stays on disk through it while gameinfo.gi moves on. Build 6946 (2026-10-07) renamed
 * the language path key, `Game_Language` to `Game_AudioLanguage`, and the engine stopped
 * reading the old name: a patch from the day before still mounted our folder and silently
 * dropped dota_<language>, so every mod there stopped loading. Comparing the meaningful lines,
 * not the bytes, keeps a Valve edit to a comment from counting as a change.
 */
export function patchIsCurrent(branchText: string, gameinfoText: string, folder: string): boolean {
  const ours = searchPathLines(searchPathsBlock(branchText));
  const want = searchPathLines(withModFolder(searchPathsBlock(gameinfoText), folder));
  return ours.length === want.length && ours.every((l, i) => l === want[i]);
}

/** Put the block inside branchspecific's FileSystem section (its keys win over gameinfo.gi). */
export function patchedBranch(branchText: string, block: string): string {
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
export function stripPatch(text: string): string {
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
 * The original branchspecific file, reconstructed and CHECKED against Valve's own list
 * rather than trusted. A copy this app made in an older version can be a tab short of the
 * real thing, and a wrong copy is worse than none: it loads, so nothing looks broken until
 * the client quietly stops finding matches. The only thing a reconstruction can get wrong
 * is the indent ahead of the FileSystem closing brace, so when the hash disagrees the few
 * shapes that indent can take are tried and the one Valve signed is kept.
 */
export function restoreBranch(text: string, want: Hashes | null): { text: string; verified: boolean } {
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
