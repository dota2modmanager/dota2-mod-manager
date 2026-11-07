/**
 * Every picture and the one film, named once.
 *
 * Four places need to agree about these: the landing that shows them, the structured data that
 * nominates them, the sitemap that submits them, and the alt text that describes them. They
 * were spread across three files, which is how a site ends up with a screenshot whose alt says
 * "Каталог модов в приложении" and a sitemap that never mentions it exists.
 *
 * The names are what they are on purpose. `ru-catalog.webp` tells an image crawler nothing;
 * the file name, the alt and the caption are the only three things it has, and the site was
 * spending all three on the word "catalog". Google Images had seven pictures to choose from on
 * the entire site and showed three.
 */
export type Lang = 'en' | 'ru';

export const shotNames = ['catalog', 'builder', 'workshop', 'effects', 'hud', 'my-mods'] as const;
export type ShotName = (typeof shotNames)[number];

export const shotUrl = (lang: Lang, name: ShotName) =>
  `/screenshots/dota-2-mod-manager-${name}-${lang}.webp`;

/* The same picture, small enough for a phone.
 *
 * site/tools/shots.mjs writes these at build time. Without them a phone decodes the full
 * 1360x860 frame to show it 333 pixels wide, three times over as the screenshots scroll into
 * view, and iOS ends the tab rather than the page.
 */
export const SMALL_SHOT = 760;
export const smallUrl = (url: string) => url.replace(/\.webp$/, `-${SMALL_SHOT}.webp`);
export const srcsetFor = (url: string, fullWidth: number) =>
  `${smallUrl(url)} ${SMALL_SHOT}w, ${url} ${fullWidth}w`;

export const tourUrl = (lang: Lang) => `/video/dota-2-mod-manager-tour-${lang}.webm`;
export const tourPoster = (lang: Lang) => `/video/dota-2-mod-manager-tour-${lang}.webp`;

/** tools/site-tour.mjs films both languages to about 41 seconds. */
export const TOUR_SECONDS = 41;
export const TOUR_ISO = 'PT41S';
/** When the clip was first published with the site. */
export const TOUR_UPLOADED = '2026-08-09';
export const TOUR_SIZE = { width: 1100, height: 696 };
export const SHOT_SIZE = { width: 1360, height: 860 };

/**
 * The walkthrough hanta filmed, and where its thumbnail lives.
 *
 * The picture is our own copy of his YouTube thumbnail rather than a hot-link, so a visitor
 * who has not clicked anything is not announced to another domain. See Creator.astro for how
 * to refresh it if he changes the artwork.
 */
export const CREATOR = {
  id: 'Z_yalpuP6pA',
  video: 'https://www.youtube.com/watch?v=Z_yalpuP6pA',
  channel: 'https://www.youtube.com/@hqnta',
  thumb: '/video/dota-2-mod-manager-review-hanta.webp',
  size: { width: 1280, height: 720 },
} as const;

/**
 * What each picture is of, in a sentence.
 *
 * An alt that repeats the caption printed under the image teaches nothing twice. These say
 * which screen it is and what is on it, in the words somebody would search for.
 */
export const shotAlt: Record<Lang, Record<ShotName, string>> = {
  en: {
    catalog:
      'The Dota 2 mod catalog inside Dota 2 Mod Manager: cards from the D2PFX collection with previews and tags',
    builder: 'The item builder: a Dota 2 hero in a live 3D preview next to the items for each slot',
    workshop: 'The Workshop: tools that build Dota 2 mods from the game files, grouped by what they change',
    effects: 'The effect editor: sliders for a Dota 2 ability effect next to a preview of it playing',
    hud: 'The HUD editor: a plan of the Dota 2 screen with panels to move and resize',
    'my-mods': 'My mods: installed Dota 2 mods with toggles and their load order',
  },
  ru: {
    catalog:
      'Каталог модов для Доты 2 в окне Dota 2 Mod Manager: карточки скинов из коллекции D2PFX с превью и тегами',
    builder: 'Конструктор предметов: герой Доты 2 в живом 3D-просмотре рядом с предметами для каждого слота',
    workshop: 'Мастерская: инструменты, которые собирают моды для Доты 2 из файлов игры',
    effects: 'Редактор эффектов: ползунки эффекта способности Доты 2 рядом с его проигрыванием',
    hud: 'Редактор HUD: план экрана Доты 2 с панелями, которые можно двигать и менять',
    'my-mods': 'Мои моды: установленные моды Доты 2 с переключателями и порядком загрузки',
  },
};

/** Short titles for the sitemap, where a caption and a title are separate fields. */
export const shotTitle: Record<Lang, Record<ShotName, string>> = {
  en: {
    catalog: 'Dota 2 mod catalog',
    heroes: 'Dota 2 mods by hero',
    'my-mods': 'Installed Dota 2 mods',
  },
  ru: {
    catalog: 'Каталог модов для Доты 2',
    heroes: 'Моды Доты 2 по героям',
    'my-mods': 'Установленные моды Доты 2',
  },
};

export const tourText: Record<Lang, { name: string; description: string }> = {
  en: {
    name: 'Dota 2 Mod Manager in one take',
    description:
      'Forty seconds of Dota 2 Mod Manager: install a mod from the catalog, dress a hero in the item builder, open the Workshop, make an effect bigger, move the minimap and switch a mod off in My mods. Filmed off the app on the real game. We cut the waits for loading and sped nothing up.',
  },
  ru: {
    name: 'Dota 2 Mod Manager одним дублем',
    description:
      'Сорок секунд работы Dota 2 Mod Manager: ставим мод из каталога, одеваем героя в конструкторе, открываем Мастерскую, увеличиваем эффект, двигаем мини-карту и выключаем мод в «Моих модах». Снято с приложения на настоящей игре. Мы вырезали только ожидание загрузки, ускорения нет.',
  },
};
