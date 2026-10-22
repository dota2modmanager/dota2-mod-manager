/* The lock on the ninth theme (ui/pumpkin.ts asks it, ui/theme.ts wears what it opens).
 *
 * The app keeps a hash of the key, not the key. Whoever brings the right one gets the theme;
 * nothing else is behind it, so the hash is only there to keep the word itself out of the build.
 *
 * Forgiving about how it is typed: case, spaces and dashes do not count, and neither does the
 * keyboard being left on Russian. The key is Latin, and on a ЙЦУКЕН layout the same keys type
 * Cyrillic, so each attempt is also read back as the Latin keys that were pressed, and as the
 * Latin letters that Cyrillic ones look like (Т for T, Е for E).
 */

const LOCK = '2400f82b4a233f1b72eeb574664bac4b87fa9cb3f83e1fe72a6ff67f7dcd6beb';

// the ЙЦУКЕН keys, in the order of the QWERTY keys they sit on
const RU_KEYS = 'йцукенгшщзфывапролдячсмить';
const EN_KEYS = 'qwertyuiopasdfghjklzxcvbnm';
// Cyrillic capitals that look like Latin ones
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };

const plain = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Every reading of what was typed that could be the key, without duplicates. */
export function readings(typed: string): string[] {
  const asKeys = [...typed.toLowerCase()].map((c) => { const i = RU_KEYS.indexOf(c); return i < 0 ? c : EN_KEYS[i]; }).join('');
  const asLooks = [...typed.toUpperCase()].map((c) => LOOKALIKE[c] ?? c).join('');
  return [...new Set([plain(typed), plain(asKeys), plain(asLooks)])].filter(Boolean);
}

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether what was typed opens the lock. */
export async function opens(typed: string): Promise<boolean> {
  for (const r of readings(typed)) if ((await sha256(r)) === LOCK) return true;
  return false;
}
