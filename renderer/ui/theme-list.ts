/* Which themes the window can wear, which of them the mascot goes round, and what each is
 * called. Plain data so it can be tested; ui/theme.ts puts a theme on the window and
 * settings/ThemesBlock.tsx draws the list as cards. The colours are styles/themes.css.
 *
 * Eight heroes' palettes first (the catalog site's own), then the app's own six, which are
 * not anybody's hero and so borrow the mascot of the hero whose colours they are closest to.
 * Those six are picked in Settings only: the mascot's round stays the one it was.
 * After them, only once they are there: the user's theme from a file, the secret and the
 * bloody night. */

export const HEROES = ['ursa', 'brew', 'fura', 'storm', 'invoker', 'meepo', 'bh', 'axe'] as const;
/** the app's own themes, each a floor and an accent with a gradient trim along the title bar; the
 * last three are backlit, their buttons and cards glowing (RGB round the spectrum, the others pulsing) */
export const EXTRA = ['sunset', 'abyss', 'neon', 'rgb', 'plasma', 'toxic'] as const;
export const CUSTOM = 'custom';
export const SECRET = 'secret';
export const BLOOD = 'blood';

/** whose face the mascot shows while one of the app's own themes is worn */
export const MASCOT: Record<string, string> = { sunset: 'axe', abyss: 'storm', neon: 'meepo', rgb: 'invoker', plasma: 'ursa', toxic: 'fura' };

const HERO_NAMES: Record<string, string> = {
  ursa: 'Ursa', brew: 'Brewmaster', fura: "Nature's Prophet", storm: 'Storm Spirit',
  invoker: 'Invoker', meepo: 'Meepo', bh: 'Bounty Hunter', axe: 'Axe',
};

type Has = { custom: boolean; secret: boolean; blood: boolean };
const optional = (has: Has) => [...(has.custom ? [CUSTOM] : []), ...(has.secret ? [SECRET] : []), ...(has.blood ? [BLOOD] : [])];

/** The themes the mascot goes round: the ones it always had. The app's own are worn from Settings
 * only, so a click on the mascot still means what it meant before they came. */
export function themeRound(has: Has): string[] {
  return [...HEROES, ...optional(has)];
}

/** Every theme there is to wear, as Settings lists them: the heroes, the app's own, then the rest. */
export function themeChoices(has: Has): string[] {
  return [...HEROES, ...EXTRA, ...optional(has)];
}

/** A theme's name as the settings show it: a hero's own name, or the app's word for it. */
export function themeName(id: string): string {
  if (HERO_NAMES[id]) return HERO_NAMES[id];
  switch (id) {
    case 'sunset': return L`Закат`;
    case 'abyss': return L`Бездна`;
    case 'neon': return L`Неон`;
    case 'rgb': return 'RGB';
    case 'plasma': return L`Плазма`;
    case 'toxic': return L`Токсик`;
    case CUSTOM: return L`Моя тема`;
    case SECRET: return L`Секретная`;
    case BLOOD: return L`Кровавая ночь`;
    default: return id;
  }
}
