/* The catalog's rules for a mod's name (the upload page's setupUi/ensureHeroInName):
 * Latin letters, digits and the hyphen a hero's own name carries, with single spaces, a first capital on every word, 29 characters
 * (39 for the two heroes whose own names are that long), and a hero's mod carries the hero's
 * name with a title after it. The window applies them as the name is typed and when a hero is
 * picked, so what the author sees is what the catalog accepts. */

/** A hero this category belongs to: the name is expected to carry his. */
export const HERO_CATEGORIES = ['heroes', 'hero-items', 'herofx', 'hero-sounds'];

/** Nature's Prophet and Keeper of the Light have names longer than the ordinary room. */
const LONG_HEROES = ['keeperofthelight', 'naturesprophet'];
const DEFAULT_LIMIT = 29;

/** The characters the catalog takes in a mod's name: Latin letters, digits, spaces and hyphens. */
const ALLOWED = /[a-zA-Z0-9 -]/;

/** A name with punctuation and accents removed, as the catalog compares heroes. */
export const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** How many characters the name may have for this hero. */
export function nameLimit(hero: string): number {
  return LONG_HEROES.includes(bare(hero)) ? 39 : DEFAULT_LIMIT;
}

/** A hero's name as it goes into a mod's name: a hyphen stays, other symbols and apostrophes do not. */
export function heroAsName(hero: string): string {
  return String(hero || '').replace(/['\u2019]/g, '').replace(/[^a-zA-Z0-9 -]+/g, ' ').replace(/-+/g, '-').replace(/\s+/g, ' ').trim();
}

/** Keep what the catalog takes, one space between words, and at most max characters. */
export function cleanName(raw: string, max = DEFAULT_LIMIT): string {
  let kept = '';
  for (const ch of String(raw || '')) {
    if (!ALLOWED.test(ch)) continue;
    if (ch === ' ' && (!kept || /[ -]$/.test(kept))) continue;
    if (ch === '-' && (!kept || /[ -]$/.test(kept))) continue;
    if (kept.length >= max) break;
    kept += ch;
  }
  return kept.trim().replace(/[ -]+$/, '');
}

/** The first letter of every word capital, the rest lower, apostrophes kept inside a word. */
export function titleCaseWords(raw: string): string {
  return String(raw || '').replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (word) => {
    if (word.includes("'")) {
      const [first, ...rest] = word.split("'");
      return first[0].toUpperCase() + first.slice(1).toLowerCase() + "'" + rest.map((p) => p.toLowerCase()).join("'");
    }
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  });
}

/** The name as it is saved: cleaned, title-cased, and carrying the hero in a hero's mod. */
export function nameFor(raw: string, hero: string, heroCategory: boolean): string {
  const cleaned = titleCaseWords(cleanName(raw, nameLimit(hero)));
  return heroCategory ? ensureHero(cleaned, hero) : cleaned;
}

/** Put the hero's name at the front when the name does not carry it yet. */
export function ensureHero(name: string, hero: string): string {
  const label = heroAsName(hero);
  if (!label) return name;
  if (!name) return label;
  if (bare(name).includes(bare(hero))) return name;
  const combined = `${label} ${name}`;
  return combined.length <= nameLimit(hero) ? combined : name;
}

/** The hero name a mod's name already carries, if it carries one of these heroes. */
export function heroIn(name: string, heroes: string[]): string | null {
  const key = bare(name);
  let found: string | null = null;
  for (const hero of heroes) {
    const token = bare(hero);
    if (token && key.includes(token) && (!found || token.length > bare(found).length)) found = hero;
  }
  return found;
}

/** Swap the hero a name already carries for the newly picked one, the way the site does. */
export function swapHero(name: string, next: string, heroes: string[]): string | null {
  const found = heroIn(name, heroes);
  if (!found || !next) return null;
  const tokens = String(found).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return null;
  const re = new RegExp('(?<![a-z0-9])' + tokens.join('[^a-z0-9]*') + '(?![a-z0-9])', 'i');
  if (!re.test(name)) return null;
  return name.replace(re, () => heroAsName(next)).replace(/\s+/g, ' ').trim();
}
