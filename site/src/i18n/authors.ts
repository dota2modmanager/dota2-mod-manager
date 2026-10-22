/**
 * The words of the authors' pages (/authors/ and /authors/<slug>/), in both languages. {author}
 * is the name as the catalog writes it; {count} {word} agree by Intl's plural rules.
 */
export interface AuthorsCopy {
  indexTitle: string;
  indexH1: string;
  indexLead: string;
  /** "{top}": the three with the most mods */
  indexDescription: string;
  title: string;
  h1: string;
  description: string;
  lead: string;
  /** the kinds of mod they make most */
  kinds: string;
  /** "{author} on Telegram" */
  profile: string;
  back: string;
  others: string;
  nav: string;
}

export const authorsCopy: Record<'en' | 'ru', AuthorsCopy> = {
  en: {
    indexTitle: 'Who makes Dota 2 mods: the authors of the D2PFX catalog',
    indexH1: 'Who makes the mods',
    indexLead: 'Everybody with three or more mods in the D2PFX catalog, most mods first. Each page holds all of that author\'s mods and the way to their profile.',
    indexDescription: 'The authors of Dota 2 mods in the D2PFX catalog, each with every mod they made: {top} and more.',
    title: 'Dota 2 mods by {author}',
    h1: 'Mods by {author}',
    description: '{count} Dota 2 {word} by {author} from the D2PFX catalog, with previews. Mod Manager installs any of them in one click.',
    lead: '{count} {word} in the D2PFX catalog.',
    kinds: 'Most of them: {kinds}.',
    profile: '{author} on {service}',
    back: 'All authors',
    others: 'More authors',
    nav: 'Authors',
  },
  ru: {
    indexTitle: 'Кто делает моды для Доты 2: авторы каталога D2PFX',
    indexH1: 'Кто делает моды',
    indexLead: 'Все, у кого в каталоге D2PFX три мода и больше, сначала у кого больше. На странице автора все его моды и ссылка на профиль.',
    indexDescription: 'Авторы модов для Доты 2 из каталога D2PFX, у каждого все его моды: {top} и другие.',
    title: 'Моды для Доты 2 от {author}',
    h1: 'Моды от {author}',
    description: '{count} {word} для Доты 2 от {author} из каталога D2PFX, с превью. Mod Manager ставит любой в один клик.',
    lead: '{count} {word} в каталоге D2PFX.',
    kinds: 'Больше всего: {kinds}.',
    profile: '{author} в {service}',
    back: 'Все авторы',
    others: 'Другие авторы',
    nav: 'Авторы',
  },
};
