/**
 * The words around the changelog on /changes/. The notes themselves are the changelog's own
 * (src/lib/changes.ts), so this is only the page's title, its headings and the labels on a release.
 */
export interface ChangesCopy {
  title: string;
  h1: string;
  description: string;
  latest: string;
  /** "Released 18 Oct 2026" */
  released: string;
  onGithub: string;
  versions: string;
  /** a folded release: its first topic, and how many more */
  more: string;
  /** a section the Russian changelog has no text for, shown in English */
  inEnglish: string;
}

export const changesCopy: Record<'en' | 'ru', ChangesCopy> = {
  en: {
    title: "What's new in Dota 2 Mod Manager",
    h1: "What's new",
    description: 'Every Dota 2 Mod Manager release and what it changed, newest first. The app updates itself, so you get all of it without reinstalling.',
    latest: 'Latest',
    released: 'Released {date}',
    onGithub: 'Release on GitHub',
    versions: 'Versions',
    more: 'and {n} more',
    inEnglish: 'This release has no notes in Russian.',
  },
  ru: {
    title: 'Что нового в Dota 2 Mod Manager',
    h1: 'Что нового',
    description: 'Все версии Dota 2 Mod Manager и что в них изменилось, сначала новые. Приложение обновляется само, ставить заново ничего не нужно.',
    latest: 'Последняя',
    released: 'Вышла {date}',
    onGithub: 'Релиз на GitHub',
    versions: 'Версии',
    more: 'и ещё {n}',
    inEnglish: 'У этой версии нет описания на русском, вот английское.',
  },
};
