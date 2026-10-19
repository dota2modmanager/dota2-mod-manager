/**
 * Every string the site shows, in both languages.
 *
 * One table rather than one file per page: the site is small, and the thing that actually
 * goes wrong with two languages is a string that exists in one and not the other. Side by
 * side, that is visible while typing. The app's own dictionaries work the same way.
 */
export const languages = { en: 'English', ru: 'Русский' } as const;
export type Lang = keyof typeof languages;

export const defaultLang: Lang = 'en';

export const ui = {
  en: {
    'site.name': 'Dota 2 Mod Manager',
    'site.tagline': 'Dota 2 mods, installed properly',

    'nav.docs': 'Docs',
    'nav.facts': 'Facts',
    'nav.transparency': 'Transparency',
    'nav.status': 'Status',
    'nav.changes': "What's new",
    'nav.authors': 'Mod authors',
    'search.open': 'Search the site',
    'search.placeholder': 'A mod, a hero or an author',
    'search.close': 'Close',
    'search.heroes': 'Heroes',
    'search.authors': 'Authors',
    'search.mods': 'Mods',
    'search.empty': 'Nothing by that name. Try fewer letters, or the English name.',
    'search.all': 'All {n} mods it finds, in the catalog',
    'search.tip': 'Ctrl K or / opens this box from any page.',
    'nav.heroes': 'Mods by hero',
    'nav.catalog': 'Catalog',
    'nav.faq': 'FAQ',
    'nav.github': 'GitHub',
    'nav.discord': 'Discord',
    'nav.download': 'Download',
    'nav.heroesShort': 'Heroes',
    'nav.guides': 'Guides',
    'menu.open': 'Menu',
    'menu.catalog': 'Search, filter, build a set',
    'menu.heroes': 'Every hero, every set',
    'menu.guides': 'How modding works',

    'foot.about': 'A free desktop app that installs Dota 2 mods from the D2PFX catalog, and takes them back out.',
    'foot.colMods': 'Mods',
    'foot.colLearn': 'Learn',
    'foot.colProject': 'Project',
    'foot.rainbowOn': 'Rainbow is on. Turn it off',
    'foot.rainbowOff': 'Turn the rainbow back on',

    'hero.title': 'Dota 2 mods, installed properly',
    'hero.lead': 'A free desktop app that installs skins, terrains, announcers and music from the community catalog, unlocks the cosmetics your account already owns, and lets you share a whole setup as one link.',
    'hero.download': 'Download for Windows',
    'hero.source': 'Source on GitHub',
    'hero.free': 'Free, open source, no account needed.',

    'foot.built': 'Built by',
    'foot.nav': 'Site sections',
    'foot.license': 'GPL-3.0, source on GitHub',
    'foot.unofficial': 'Dota 2 Mod Manager is a free community project under GPL-3.0. Valve Corporation has not endorsed it and takes no part in it.',
    'foot.marks': 'Dota 2 and the Dota 2 logo are trademarks of Valve Corporation. Game screenshots and in-game artwork belong to Valve and to the Steam Workshop authors who made them, and appear here only to show what the app does. Nothing on this site is sold.',
    /* Split around the link so the word "Discord" in the sentence is the link itself. Both
       halves are needed because the two languages put it in different places. */
    'foot.takedown.before': 'Made something shown here and want it credited differently, or gone? Say so on ',
    'foot.takedown.after': ' and it is done.',
    'foot.privacy': 'Privacy',
    'foot.terms': 'Terms',
    'foot.codesigning': 'Code signing policy',
    'foot.releases': 'Releases',

    'lang.switch': 'Русский',
    /* The offer of this language, shown on the other language's pages (Base.astro): these three
       are in English because a Russian page shows them to somebody who does not read Russian. */
    'lang.offer': 'This page is also in English.',
    'lang.offerOpen': 'Open it',
    'lang.offerClose': 'Close',
  },
  ru: {
    'site.name': 'Dota 2 Mod Manager',
    'site.tagline': 'Моды для Dota 2, поставленные по-человечески',

    'nav.docs': 'Документация',
    'nav.facts': 'Цифры и факты',
    'nav.transparency': 'Прозрачность',
    'nav.status': 'Статус',
    'nav.changes': 'Что нового',
    'nav.authors': 'Авторы модов',
    'search.open': 'Поиск по сайту',
    'search.placeholder': 'Мод, герой или автор',
    'search.close': 'Закрыть',
    'search.heroes': 'Герои',
    'search.authors': 'Авторы',
    'search.mods': 'Моды',
    'search.empty': 'Ничего с таким названием. Попробуй меньше букв или английское имя.',
    'search.all': 'Все найденные моды в каталоге: {n}',
    'search.tip': 'Ctrl K или / открывает поиск с любой страницы.',
    'nav.heroes': 'Моды по героям',
    'nav.catalog': 'Каталог',
    'nav.faq': 'Вопросы',
    'nav.github': 'GitHub',
    'nav.discord': 'Discord',
    'nav.download': 'Скачать',
    'nav.heroesShort': 'Герои',
    'nav.guides': 'Гайды',
    'menu.open': 'Меню',
    'menu.catalog': 'Поиск, фильтры, своя сборка',
    'menu.heroes': 'Все герои и их сеты',
    'menu.guides': 'Как устроены моды',

    'foot.about': 'Бесплатная программа: ставит моды для Доты 2 из каталога D2PFX и убирает их обратно.',
    'foot.colMods': 'Моды',
    'foot.colLearn': 'Разобраться',
    'foot.colProject': 'Проект',
    'foot.rainbowOn': 'Радуга включена. Выключить',
    'foot.rainbowOff': 'Включить радугу обратно',

    'hero.title': 'Моды для Dota 2, поставленные по-человечески',
    'hero.lead': 'Бесплатная программа: ставит скины, ландшафты, комментаторов и музыку из общего каталога, открывает косметику, которая у тебя и так есть, и позволяет поделиться всей сборкой одной ссылкой.',
    'hero.download': 'Скачать для Windows',
    'hero.source': 'Исходники на GitHub',
    'hero.free': 'Бесплатно, открытый код, без регистрации.',

    'foot.built': 'Сделал',
    'foot.nav': 'Разделы сайта',
    'foot.license': 'GPL-3.0, исходники на GitHub',
    'foot.unofficial': 'Dota 2 Mod Manager - бесплатный проект сообщества под лицензией GPL-3.0. Valve Corporation его не одобряла и к нему не причастна.',
    'foot.marks': 'Dota 2 и логотип Dota 2 - товарные знаки Valve Corporation. Скриншоты игры и внутриигровой арт принадлежат Valve и авторам работ в Steam Workshop, а здесь показаны только чтобы объяснить, что делает программа. Ничего на этом сайте не продаётся.',
    'foot.takedown.before': 'Сделал что-то из показанного здесь и хочешь другую подпись или чтобы это убрали? Напиши в ',
    'foot.takedown.after': ', и так и будет.',
    'foot.privacy': 'Приватность',
    'foot.terms': 'Условия',
    'foot.codesigning': 'Политика подписи кода',
    'foot.releases': 'Релизы',

    'lang.switch': 'English',
    'lang.offer': 'Эта страница есть на русском.',
    'lang.offerOpen': 'Открыть',
    'lang.offerClose': 'Закрыть',
  },
} as const;

/** The translator for one page. Falls back to English so a missing string is visible, not blank. */
export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)['en']): string {
    return (ui[lang] as Record<string, string>)[key] ?? ui[defaultLang][key];
  };
}

/** "/ru/docs/" -> "ru"; anything else is English, which sits at the root. */
export function langFromUrl(url: URL): Lang {
  const [, first] = url.pathname.split('/');
  return first in languages ? (first as Lang) : defaultLang;
}

/** The same page in the other language, for the switcher and for hreflang. */
export function pathIn(lang: Lang, path: string): string {
  const bare = path.replace(/^\/(en|ru)(?=\/|$)/, '') || '/';
  const withSlashes = bare.endsWith('/') ? bare : `${bare}/`;
  return lang === defaultLang ? withSlashes : `/${lang}${withSlashes}`;
}
