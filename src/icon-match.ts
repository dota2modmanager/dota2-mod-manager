// Which wiki file is an item's picture: the file names to try first, and how a wiki's listing is
// matched against the game's name, give or take a typo but never a different number or an extra
// word. Pure functions; src/icon-wiki.ts asks the wikis and src/icons.ts keeps what they answer.

// Names compared without spacing, punctuation or case: the wiki and the game write those
// their own ways, and none of it changes which item is meant. Nor does the trailing "Skin"
// the schema gives some HUDs and the wiki does not.
export const plain = (s: unknown) => String(s).replace(/\bHUD[ _]Skin$/i, 'HUD').toLowerCase().replace(/[^a-z0-9]+/g, '');

// The parts a typo check must never forgive: "Loading Screen VI" and "Loading Screen IV"
// are two different pictures one swapped letter apart.
export const numbering = (s: unknown) => (String(s).match(/\d+|\b[IVXLC]{1,6}\b/g) || []).join(' ');

// Levenshtein distance, only ever asked about strings that are nearly the same already.
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// A "Loading Screen" / "Versus Screen" cosmetic is routinely undocumented on its own, even
// when the outfit it belongs to has a picture: the wiki draws the line at the outfit, not
// every slot it fills. Stripped of the suffix, the name is worth one more try against the
// same two wikis - the outfit's own icon is still a recognisable stand-in for its own screen.
const SCREEN_SUFFIX = /\s*-?\s*(?:Loading[ ]?Screen|Versus[ ]?Screen|LS)$/i;
export function stripScreenSuffix(name: string): string | null {
  const base = String(name).replace(SCREEN_SUFFIX, '').trim();
  return base && base !== String(name).trim() ? base : null;
}

/**
 * Which of a list of "File:..." / "Cosmetic_icon_....png" titles is this item's picture,
 * shared by both wikis' listings. A title counts only when it is the same name give or take
 * a typo: a loose match would put a stranger's picture on the card, which is worse than an
 * empty tile, so an extra word ("… Bundle") or a different number is enough to rule it out.
 */
export function titlePicker(name: string): (titles: string[]) => string | null {
  const want = plain(name);
  return (titles) => {
    let best: { d: number; file: string } | null = null;
    for (const rawTitle of titles) {
      const title = rawTitle.replace(/^File:/i, '');
      const m = /^Cosmetic[ _]icon[ _](.+)\.(?:png|jpe?g|webp)$/i.exec(title);
      if (!m || numbering(m[1]) !== numbering(name)) continue;
      const got = plain(m[1]);
      // a typo swaps or replaces letters, it does not add or drop words: same length only,
      // which is what keeps "Alliance HUD Bundle" away from "Alliance HUD"
      const d = got === want ? 0 : got.length === want.length ? editDistance(got, want) : Infinity;
      if (d <= 2 && (!best || d < best.d)) best = { d, file: title.replace(/ /g, '_') };
    }
    return best ? best.file : null;
  };
}

// The wiki serves WebP to a browser and PNG to anything else; both render in the app.
export function sniff(buf: Buffer): string | null {
  const hex = buf.slice(0, 4).toString('hex');
  if (hex === '89504e47') return 'image/png';
  if (hex === '52494646' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return null;
}

/**
 * Wiki file names to try for a cosmetic: "Weather Rain" -> Cosmetic_icon_Weather_Rain.png.
 * The schema's own name is right about nine times out of ten; the rest differ by
 * punctuation the wiki spells its own way, so a couple of spellings follow before the
 * picture counts as missing. "Mega-Kills: Axe" is filed as both Mega-Kills_Axe and
 * Mega-Kills-_Axe, and the game's typographic apostrophe is a plain one there.
 */
export function cosmeticFileNames(name: string): string[] {
  const clean = String(name).replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (const form of [clean, clean.replace(/:/g, ''), clean.replace(/:/g, '-'), String(name).trim()]) {
    const file = 'Cosmetic_icon_' + form.replace(/\s+/g, '_') + '.png';
    if (form && !out.includes(file)) out.push(file);
  }
  return out;
}

/**
 * Files whose name starts with the item's first word or two. Exact and always answered,
 * unlike the search, which returns nothing at all for half of these names.
 */
export function prefixOf(name: string): string | null {
  const words = String(name).replace(/[^\w\s'.-]/g, '').split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, words[0].length < 5 ? 2 : 1).join('_') : null;
}

/**
 * Wiki file names for a hero's own default portrait - not a cosmetic look, the hero
 * itself. Unlike a cosmetic's, this naming is exact (every hero has exactly one page,
 * named after the hero), so there is no search fallback to fall through to.
 */
export function heroFileNames(heroName: string): string[] {
  const clean = String(heroName).replace(/\s+/g, '_');
  return [`${clean}_icon.png`, `${clean}_minimap_icon.png`];
}
