/* Which note about Minify fits this machine, decided apart from the markup so it can be
 * tested without a window (test/minify-notice.test.js). The words live in library/FolderBanners.tsx.
 *
 * src/minify.js answers whose mods the game reads right now: 'ours', 'minify', 'both',
 * 'neither' or 'unknown'. 'neither' covers three different machines, and the banner used to
 * say the same sentence to all of them:
 *   - the game reads our folder, which simply holds none of our mods yet;
 *   - the game reads Minify's folder, which is empty;
 *   - the game reads a third folder, filled by nobody.
 * On the first, a fresh install next to Minify, it said "the game reads dota_russian and there
 * are no mods in it; ours are in dota_russian", which is both alarming and a contradiction.
 * And 'unknown' (the game's language not read yet) fell through to "the game reads our
 * folder", a guess the banner is not allowed to make.
 */

/**
 * @param {object|null} m  the minify block of the settings (src/minify.js readMinify)
 * @param {number} [ourMods] how many mods this app has installed
 * @returns {{ kind: 'info'|'warn', case: 'unmountable'|'minify-live'|'shared'|'unknown'|'ours-read'|'minify-empty'|'elsewhere' }|null}
 */
export function minifyNotice(m, ourMods = 0) {
  if (!m || !m.present) return null;
  // it builds into a folder this game cannot be pointed at: its mods do nothing, ours are fine
  if (!m.mounts) return { kind: 'info', case: 'unmountable' };
  if (m.live === 'minify') return { kind: 'warn', case: 'minify-live' };
  if (m.live === 'both' || m.sharing) return { kind: 'info', case: 'shared' };
  // which folder the game reads is not known: say only what is
  if (m.live === 'unknown' || !m.mounted) return { kind: 'info', case: 'unknown' };
  // our folder is the one read, with or without mods in it yet
  if (m.live === 'ours' || m.mounted === m.ourFolder) return { kind: 'info', case: 'ours-read' };
  // Minify's folder is the one read and it is empty: anything of ours sits dark
  if (m.mounted === m.folder) return { kind: ourMods > 0 ? 'warn' : 'info', case: 'minify-empty' };
  return { kind: 'warn', case: 'elsewhere' };
}
