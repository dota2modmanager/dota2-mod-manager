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
    'nav.heroes': 'Mods by hero',
    'nav.catalog': 'Catalog',
    'nav.faq': 'FAQ',
    'nav.github': 'GitHub',
    'nav.discord': 'Discord',
    'nav.download': 'Download',

    'hero.title': 'Dota 2 mods, installed properly',
    'hero.lead': 'A free desktop app that installs skins, terrains, announcers and music from the community catalog, unlocks the cosmetics your account already owns, and lets you share a whole setup as one link.',
    'hero.download': 'Download for Windows',
    'hero.source': 'Source on GitHub',
    'hero.free': 'Free, open source, no account needed.',

    'foot.built': 'Built by',
    'foot.license': 'GPL-3.0, source on GitHub',
    'foot.unofficial': 'Dota 2 Mod Manager is a free community project under GPL-3.0. Valve Corporation has not endorsed it and takes no part in it.',
    'foot.marks': 'Dota 2 and the Dota 2 logo are trademarks of Valve Corporation. Game screenshots and in-game artwork belong to Valve and to the Steam Workshop authors who made them, and appear here only to show what the app does. Nothing on this site is sold.',
    /* Split around the link so the word "Discord" in the sentence is the link itself. Both
       halves are needed because the two languages put it in different places. */
    'foot.takedown.before': 'Made something shown here and want it credited differently, or gone? Say so on ',
    'foot.takedown.after': ' and it is done.',
    'foot.privacy': 'Privacy',
    'foot.terms': 'Terms',
    'foot.codesigning': 'Code signing',
    'foot.releases': 'Releases',

    'lang.switch': 'Русский',
  },
  ru: {
    'site.name': 'Dota 2 Mod Manager',
    'site.tagline': 'Моды для Dota 2, поставленные по-человечески',

    'nav.docs': 'Документация',
    'nav.facts': 'Цифры и факты',
    'nav.transparency': 'Прозрачность',
    'nav.status': 'Статус',
    'nav.heroes': 'Моды по героям',
    'nav.catalog': 'Каталог',
    'nav.faq': 'Вопросы',
    'nav.github': 'GitHub',
    'nav.discord': 'Discord',
    'nav.download': 'Скачать',

    'hero.title': 'Моды для Dota 2, поставленные по-человечески',
    'hero.lead': 'Бесплатная программа: ставит скины, ландшафты, комментаторов и музыку из общего каталога, открывает косметику, которая у тебя и так есть, и позволяет поделиться всей сборкой одной ссылкой.',
    'hero.download': 'Скачать для Windows',
    'hero.source': 'Исходники на GitHub',
    'hero.free': 'Бесплатно, открытый код, без регистрации.',

    'foot.built': 'Сделал',
    'foot.license': 'GPL-3.0, исходники на GitHub',
    'foot.unofficial': 'Dota 2 Mod Manager - бесплатный проект сообщества под лицензией GPL-3.0. Valve Corporation его не одобряла и к нему не причастна.',
    'foot.marks': 'Dota 2 и логотип Dota 2 - товарные знаки Valve Corporation. Скриншоты игры и внутриигровой арт принадлежат Valve и авторам работ в Steam Workshop, а здесь показаны только чтобы объяснить, что делает программа. Ничего на этом сайте не продаётся.',
    'foot.takedown.before': 'Сделал что-то из показанного здесь и хочешь другую подпись или чтобы это убрали? Напиши в ',
    'foot.takedown.after': ', и так и будет.',
    'foot.privacy': 'Приватность',
    'foot.terms': 'Условия',
    'foot.codesigning': 'Подпись кода',
    'foot.releases': 'Релизы',

    'lang.switch': 'English',
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
