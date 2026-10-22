/**
 * The words of one mod's own page (/mods/<key>/), in both languages.
 *
 * A mod's page is what a link to one mod opens, from a chat or from a search, so its title and
 * first lines say what the mod is for somebody who has not seen the catalog: a mod for which hero,
 * or from which part of the catalog, and who made it. {heroAcc} is the Russian accusative, the
 * case "мод на Пуджа" is typed in.
 */
export interface ModPageCopy {
  titleHero: string;
  titleKind: string;
  leadHero: string;
  leadHeroBy: string;
  leadKind: string;
  leadKindBy: string;
  install: string;
  styles: string;
  /** a style the catalog gives no name: the app calls it the same */
  plainStyle: string;
  /** a look's picture, for its alt text */
  styleAlt: string;
  share: string;
  shared: string;
  /** "{n} {word} in your set." */
  inSet: string;
  openSet: string;
  note: string;
  /** on a phone, which cannot run the app */
  noteTouch: string;
  noApp: string;
  download: string;
  downloadFor: string;
  moreHero: string;
  moreKind: string;
  allHero: string;
  allKind: string;
}

export const modPage: Record<'en' | 'ru', ModPageCopy> = {
  en: {
    titleHero: '{mod}: a {hero} mod for Dota 2',
    titleKind: '{mod}: a Dota 2 mod from {kind}',
    leadHero: 'A {hero} mod from the D2PFX catalog.',
    leadHeroBy: 'A {hero} mod by {author}, from the D2PFX catalog.',
    leadKind: 'A mod from the {kind} section of the D2PFX catalog.',
    leadKindBy: 'A mod by {author} from the {kind} section of the D2PFX catalog.',
    install: 'Mod Manager installs it in one click and takes it out the same way.',
    styles: 'Styles',
    plainStyle: 'Default',
    styleAlt: '{mod}, style {style}',
    share: 'Share the link',
    shared: 'Link copied',
    inSet: '{n} {word} in your set.',
    openSet: 'Open the set in the catalog',
    note: 'The button opens the app if you have it.',
    noteTouch: 'Mod Manager runs on Windows and Linux. Send yourself the link and open it on the computer.',
    noApp: 'No app yet?',
    download: 'Download Mod Manager',
    downloadFor: 'for Windows or Linux.',
    moreHero: 'More for {hero}',
    moreKind: 'More from {kind}',
    allHero: 'All {n} {word} for {hero}',
    allKind: 'The whole {kind} section',
  },
  ru: {
    titleHero: '{mod}: мод на {heroAcc} для Доты 2',
    titleKind: '{mod}: мод для Доты 2, раздел «{kind}»',
    leadHero: 'Мод на {heroAcc} из каталога D2PFX.',
    leadHeroBy: 'Мод на {heroAcc} от {author}, из каталога D2PFX.',
    leadKind: 'Мод из раздела «{kind}» каталога D2PFX.',
    leadKindBy: 'Мод от {author} из раздела «{kind}» каталога D2PFX.',
    install: 'Mod Manager ставит его в один клик и так же убирает.',
    styles: 'Стили',
    plainStyle: 'Обычный',
    styleAlt: '{mod}, стиль {style}',
    share: 'Поделиться ссылкой',
    shared: 'Ссылка скопирована',
    inSet: 'В наборе {n} {word}.',
    openSet: 'Открыть набор в каталоге',
    note: 'Кнопка откроет приложение, если оно у тебя стоит.',
    noteTouch: 'Mod Manager работает на Windows и Linux. Скинь себе ссылку и открой её на компьютере.',
    noApp: 'Ещё нет?',
    download: 'Скачай Mod Manager',
    downloadFor: 'для Windows или Linux.',
    moreHero: 'Ещё моды на {heroAcc}',
    moreKind: 'Ещё из раздела «{kind}»',
    allHero: 'Все {n} {word} на {heroAcc}',
    allKind: 'Весь раздел «{kind}»',
  },
};
