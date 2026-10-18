/**
 * The words of the catalog's browser, in both languages: the search, the sorting, the cards, the
 * closer look at one mod, and the set a visitor collects to send to the app.
 *
 * Counts arrive as {n}, and the noun that agrees with them is picked from `mods` by Intl's plural
 * rules, in the page and in the script alike: "1 мод", "3 мода", "1 557 модов".
 */
export interface BrowseCopy {
  searchLabel: string;
  searchPlaceholder: string;
  sortLabel: string;
  sortNew: string;
  sortOld: string;
  sortAZ: string;
  sortMost: string;
  all: string;
  kinds: string;
  /** "Showing {n} of {total}" */
  shown: string;
  clear: string;
  empty: string;
  emptyHint: string;
  more: string;
  add: string;
  remove: string;
  look: string;
  newBadge: string;
  by: string;
  kind: string;
  hero: string;
  replaces: string;
  author: string;
  added: string;
  style: string;
  openApp: string;
  copyLink: string;
  copied: string;
  noCompress: string;
  appNote: string;
  close: string;
  /** "{n} {word} in your set" */
  tray: string;
  trayHint: string;
  trayClear: string;
  setName: string;
  part: string;
  anyPart: string;
  allKinds: string;
  heroPage: string;
  kindPage: string;
  /** the link from the closer look to the mod's own page */
  modPage: string;
  mods: [string, string, string];
}

export const browse: Record<'en' | 'ru', BrowseCopy> = {
  en: {
    searchLabel: 'Search the catalog',
    searchPlaceholder: 'Name, hero or author',
    sortLabel: 'Sort',
    sortNew: 'Newest first',
    sortOld: 'Oldest first',
    sortAZ: 'A to Z',
    sortMost: 'Most mods first',
    all: 'All',
    kinds: 'Kinds of mod',
    shown: 'Showing {n} of {total}',
    clear: 'Clear the search',
    empty: 'Nothing matches that.',
    emptyHint: 'Try fewer words, or another kind.',
    more: 'Show more',
    add: 'Add to your set',
    remove: 'Take out of your set',
    look: 'Look closer at',
    newBadge: 'New',
    by: 'by',
    kind: 'Kind',
    hero: 'Hero',
    replaces: 'Replaces',
    author: 'Made by',
    added: 'Added',
    style: 'Style',
    openApp: 'Open in Mod Manager',
    copyLink: 'Copy the link',
    copied: 'Link copied',
    noCompress: 'This browser cannot build the link. Any recent Chrome, Edge, Firefox or Safari can.',
    appNote: "The button opens the app if you have it. The link leads to the mod's page, which shows the mod to anyone and offers the app.",
    close: 'Close',
    tray: '{n} {word} in your set',
    trayHint: 'Open it in the app, or send the link to a friend.',
    trayClear: 'Clear',
    setName: 'My set from the catalog',
    part: 'Replaces',
    anyPart: 'Any part',
    allKinds: 'Every kind of mod',
    heroPage: 'Everything for {hero}',
    kindPage: 'More {kind}',
    modPage: "The mod's page",
    mods: ['mod', 'mods', 'mods'],
  },
  ru: {
    searchLabel: 'Поиск по каталогу',
    searchPlaceholder: 'Название, герой или автор',
    sortLabel: 'Порядок',
    sortNew: 'Сначала новые',
    sortOld: 'Сначала старые',
    sortAZ: 'По алфавиту',
    sortMost: 'Больше модов',
    all: 'Все',
    kinds: 'Виды модов',
    shown: 'Показано {n} из {total}',
    clear: 'Сбросить поиск',
    empty: 'Ничего не нашлось.',
    emptyHint: 'Попробуй меньше слов или другой вид.',
    more: 'Показать ещё',
    add: 'Добавить в набор',
    remove: 'Убрать из набора',
    look: 'Рассмотреть',
    newBadge: 'Новый',
    by: 'автор',
    kind: 'Вид',
    hero: 'Герой',
    replaces: 'Меняет',
    author: 'Автор',
    added: 'Добавлен',
    style: 'Стиль',
    openApp: 'Открыть в Mod Manager',
    copyLink: 'Скопировать ссылку',
    copied: 'Ссылка скопирована',
    noCompress: 'Этот браузер не умеет собрать ссылку. Любой свежий Chrome, Edge, Firefox или Safari умеет.',
    appNote: 'Кнопка откроет приложение, если оно у тебя стоит. Ссылка ведёт на страницу мода: она покажет мод кому угодно и предложит приложение.',
    close: 'Закрыть',
    tray: 'В наборе {n} {word}',
    trayHint: 'Открой его в приложении или отправь ссылку другу.',
    trayClear: 'Очистить',
    setName: 'Мой набор из каталога',
    part: 'Меняет',
    anyPart: 'Что угодно',
    allKinds: 'Все виды модов',
    heroPage: 'Всё для героя {hero}',
    kindPage: 'Ещё: {kind}',
    modPage: 'Страница мода',
    mods: ['мод', 'мода', 'модов'],
  },
};
