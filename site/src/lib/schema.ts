/**
 * The structured data for the landing page, in one place so the two languages cannot drift.
 *
 * Three nodes rather than one: what the software is, what the site is, and the questions the
 * page already answers in its own words. The questions are read out of the landing copy
 * instead of being retyped here, because a FAQ in the markup that disagrees with the FAQ on
 * the screen is the one kind of structured data that gets a site penalised.
 *
 * Nothing here is invented. There is no aggregateRating, because nobody has rated it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths';
import { landing } from '../i18n/landing';
import { facts } from '../i18n/facts';
import { heroCopy } from '../i18n/heroes';
import { heroText, type Hero } from './heroes';
import { categoryText } from '../i18n/categories';
import { categories, type Category } from './categories';
import type { CatalogMod } from './catalog';
import { modText } from './mods';
import { authors, authorText, type Author } from './authors';
import { authorsCopy } from '../i18n/authors';
import { plainText } from './text';
import { ogPath } from './og';
import {
  shotNames,
  shotUrl,
  shotAlt,
  shotTitle,
  tourUrl,
  tourPoster,
  tourText,
  TOUR_ISO,
  TOUR_UPLOADED,
  SHOT_SIZE,
  TOUR_SIZE,
} from './media';

/** The app's version, read from the repository at build time so it cannot go stale. */
export function appVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
  // site/package.json says 0.0.0 one folder away, so a wrong path reads a real file and prints a
  // plausible number instead of failing. The name is what tells the two apart.
  if (pkg.name !== 'dota2-mod-manager') throw new Error(`appVersion: ${REPO_ROOT} is not the app's repository`);
  return pkg.version;
}

/**
 * The one person behind this, as a node other nodes can point at.
 *
 * Given an @id, the author of a guide, the publisher of the site and the author of the app are
 * one entity rather than three copies of a name, which is the difference between a search
 * engine knowing who made this and reading the same string three times.
 */
export function authorNode(origin = 'https://dota2modmanager.com') {
  return {
    '@type': 'Person',
    '@id': `${origin}/#author`,
    name: 'TheFleece',
    url: 'https://github.com/TheFleece',
    sameAs: ['https://github.com/TheFleece'],
  };
}

/** The app itself, with an @id so the landing and the fact sheet describe one thing twice. */
export function softwareNode(lang: 'en' | 'ru', origin = 'https://dota2modmanager.com') {
  const url = lang === 'en' ? `${origin}/` : `${origin}/${lang}/`;
  const t = landing[lang];
  const author = authorNode(origin);

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${origin}/#app`,
    name: 'Dota 2 Mod Manager',
    alternateName: lang === 'ru' ? 'Менеджер модов для Dota 2' : 'Dota 2 Mods Manager',
    applicationCategory: 'GameApplication',
    applicationSubCategory: lang === 'ru' ? 'Менеджер модов' : 'Mod manager',
    operatingSystem: 'Windows 10, Windows 11, Linux',
    url,
    downloadUrl: 'https://github.com/dota2modmanager/dota2-mod-manager/releases/latest',
    installUrl: 'https://github.com/dota2modmanager/dota2-mod-manager/releases/latest',
    softwareVersion: appVersion(),
    license: 'https://www.gnu.org/licenses/gpl-3.0.html',
    isAccessibleForFree: true,
    inLanguage: lang === 'ru' ? ['ru', 'en'] : ['en', 'ru'],
    softwareHelp: { '@type': 'CreativeWork', url: `${url}docs/` },
    // The card image, not a screenshot: it is the one picture here that still reads at the
    // size a search result shows, and it is what Google is being offered as the thumbnail.
    image: `${origin}${ogPath(lang, '/')}`,
    // Every screen, as a described object rather than a bare address. A screenshot listed as a
    // URL is a file; one with a caption and a size is a picture an image search can place.
    screenshot: shotNames.map((name) => ({
      '@type': 'ImageObject',
      url: `${origin}${shotUrl(lang, name)}`,
      contentUrl: `${origin}${shotUrl(lang, name)}`,
      name: shotTitle[lang][name],
      caption: shotAlt[lang][name],
      width: SHOT_SIZE.width,
      height: SHOT_SIZE.height,
      encodingFormat: 'image/webp',
    })),
    featureList: t.cards.map(([title]) => title),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@id': author['@id'] },
    about: {
      '@type': 'VideoGame',
      name: 'Dota 2',
      publisher: { '@type': 'Organization', name: 'Valve Corporation' },
    },
  };
}

/**
 * The fact sheet's markup.
 *
 * The page exists to be quoted, so it says the same things twice: once in prose for a reader
 * and once here for whatever reads pages instead of people. The app node is the same @id the
 * landing uses, so this is one product described in more detail, not a second product.
 */
export function factsSchema(lang: 'en' | 'ru', origin = 'https://dota2modmanager.com') {
  const page = facts[lang];
  const author = authorNode(origin);
  const url = lang === 'en' ? `${origin}/facts/` : `${origin}/${lang}/facts/`;
  const home = lang === 'en' ? `${origin}/` : `${origin}/${lang}/`;

  return [
    { '@context': 'https://schema.org', ...author },
    softwareNode(lang, origin),
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': url,
      url,
      name: page.h1,
      description: page.description,
      inLanguage: lang,
      isPartOf: { '@id': `${origin}/#website` },
      about: { '@id': `${origin}/#app` },
      author: { '@id': author['@id'] },
      publisher: { '@id': author['@id'] },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Dota 2 Mod Manager', item: home },
        { '@type': 'ListItem', position: 2, name: page.h1, item: url },
      ],
    },
  ];
}

/**
 * A hero page, said in markup.
 *
 * An ItemList of the mods, each an ImageObject with its own caption and, where the catalog
 * records one, its author. That last part is not decoration: the pictures are somebody else's
 * work shown here with permission, and crediting them in the markup is the same courtesy as
 * crediting them on the page.
 */
export function heroSchema(lang: 'en' | 'ru', hero: Hero, origin = 'https://dota2modmanager.com') {
  const c = heroCopy[lang];
  // The same words the page prints, nickname and all, rather than a second phrasing of them.
  const text = heroText(lang, hero);
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const url = `${origin}${prefix}/heroes/${hero.slug}/`;
  const author = authorNode(origin);

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': url,
      url,
      name: text.h1,
      description: text.description,
      inLanguage: lang,
      isPartOf: { '@id': `${origin}/#website` },
      about: { '@id': `${origin}/#app` },
      publisher: { '@id': author['@id'] },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: hero.mods.length,
        itemListElement: hero.mods
          .filter((m) => m.image)
          .map((m, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': 'ImageObject',
              name: m.name,
              caption: c.alt.replace('{mod}', m.name).replace('{hero}', hero.name),
              contentUrl: `${origin}${m.image!.src}`,
              width: m.image!.width,
              height: m.image!.height,
              encodingFormat: 'image/webp',
              ...(m.author ? { author: { '@type': 'Person', name: m.author, ...(m.authorUrl ? { url: m.authorUrl } : {}) } } : {}),
            },
          })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Dota 2 Mod Manager', item: `${origin}${prefix}/` },
        { '@type': 'ListItem', position: 2, name: c.indexH1, item: `${origin}${prefix}/heroes/` },
        { '@type': 'ListItem', position: 3, name: hero.name, item: url },
      ],
    },
  ];
}

/** A category page: the same shape as a hero page, listing the mods in one kind. */
export function categorySchema(lang: 'en' | 'ru', category: Category, origin = 'https://dota2modmanager.com') {
  const c = categoryText(lang, category.id);
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const url = `${origin}${prefix}/catalog/${category.id}/`;
  const author = authorNode(origin);

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': url,
      url,
      name: c.h1,
      description: c.description,
      inLanguage: lang,
      isPartOf: { '@id': `${origin}/#website` },
      about: { '@id': `${origin}/#app` },
      publisher: { '@id': author['@id'] },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: category.mods.length,
        itemListElement: category.mods
          .filter((m) => m.image)
          .map((m, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': 'ImageObject',
              name: m.name,
              caption: `${m.name}: ${c.name}`,
              contentUrl: `${origin}${m.image!.src}`,
              width: m.image!.width,
              height: m.image!.height,
              encodingFormat: 'image/webp',
              ...(m.author ? { author: { '@type': 'Person', name: m.author, ...(m.authorUrl ? { url: m.authorUrl } : {}) } } : {}),
            },
          })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Dota 2 Mod Manager', item: `${origin}${prefix}/` },
        { '@type': 'ListItem', position: 2, name: lang === 'ru' ? 'Каталог' : 'Catalog', item: `${origin}${prefix}/catalog/` },
        { '@type': 'ListItem', position: 3, name: c.name, item: url },
      ],
    },
  ];
}

/**
 * One mod's page: a page about one work, its picture, who made it and when the catalog added it,
 * and the way back to the hero or the category it belongs to. Nothing here the page does not show.
 */
export function modSchema(lang: 'en' | 'ru', mod: CatalogMod, origin = 'https://dota2modmanager.com') {
  const text = modText(lang, mod);
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const url = `${origin}${prefix}/mods/${mod.key}/`;
  const author = authorNode(origin);
  const images = mod.looks.filter((l) => l.img).map((l) => ({
    '@type': 'ImageObject',
    contentUrl: `${origin}${l.img}`,
    url: `${origin}${l.img}`,
    name: l.label ? `${mod.name} (${l.label})` : mod.name,
    width: 854,
    height: 480,
    encodingFormat: 'image/webp',
  }));
  const parent = text.hero
    ? { name: text.heroShown!, item: `${origin}${prefix}/heroes/${text.hero.slug}/` }
    : mod.cat === 'heroes'
      ? { name: text.kind, item: `${origin}${prefix}/heroes/` }
      : { name: text.kind, item: `${origin}${prefix}/catalog/${mod.cat}/` };

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemPage',
      '@id': url,
      url,
      name: text.title,
      description: text.description,
      inLanguage: lang,
      isPartOf: { '@id': `${origin}/#website` },
      publisher: { '@id': author['@id'] },
      ...(images.length ? { primaryImageOfPage: images[0] } : {}),
      mainEntity: {
        '@type': 'CreativeWork',
        name: mod.name,
        ...(images.length ? { image: images } : {}),
        ...(mod.author ? { author: { '@type': 'Person', name: mod.author, ...(mod.authorUrl ? { url: mod.authorUrl } : {}) } } : {}),
        ...(mod.date ? { dateCreated: new Date(mod.date * 1000).toISOString().slice(0, 10) } : {}),
        about: { '@type': 'VideoGame', name: 'Dota 2' },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Dota 2 Mod Manager', item: `${origin}${prefix}/` },
        { '@type': 'ListItem', position: 2, ...parent },
        { '@type': 'ListItem', position: 3, name: mod.name, item: url },
      ],
    },
  ];
}

/**
 * An author's page: a profile of a person who is not us, so the Person here has no @id of ours,
 * only the name the catalog gives and the profile it links. Their mods are the page's list.
 */
export function authorSchema(lang: 'en' | 'ru', author: Author, origin = 'https://dota2modmanager.com') {
  const text = authorText(lang, author);
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const url = `${origin}${prefix}/authors/${author.slug}/`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      '@id': url,
      url,
      name: text.title,
      description: text.description,
      inLanguage: lang,
      isPartOf: { '@id': `${origin}/#website` },
      mainEntity: {
        '@type': 'Person',
        name: author.name,
        ...(author.url ? { sameAs: [author.url] } : {}),
      },
      hasPart: {
        '@type': 'ItemList',
        numberOfItems: author.mods.length,
        itemListElement: author.mods.map((m, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: m.name,
          url: `${origin}${prefix}/mods/${m.key}/`,
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Dota 2 Mod Manager', item: `${origin}${prefix}/` },
        { '@type': 'ListItem', position: 2, name: authorsCopy[lang].nav, item: `${origin}${prefix}/authors/` },
        { '@type': 'ListItem', position: 3, name: author.name, item: url },
      ],
    },
  ];
}

/** The index of authors: a list of their pages, most mods first. */
export function authorsIndexSchema(lang: 'en' | 'ru', origin = 'https://dota2modmanager.com') {
  const c = authorsCopy[lang];
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const url = `${origin}${prefix}/authors/`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': url,
      url,
      name: c.indexH1,
      inLanguage: lang,
      isPartOf: { '@id': `${origin}/#website` },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: authors.length,
        itemListElement: authors.map((a, i) => ({ '@type': 'ListItem', position: i + 1, name: a.name, url: `${origin}${prefix}/authors/${a.slug}/` })),
      },
    },
  ];
}

export function catalogIndexSchema(lang: 'en' | 'ru', origin = 'https://dota2modmanager.com') {
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const url = `${origin}${prefix}/catalog/`;
  const author = authorNode(origin);

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': url,
      url,
      name: lang === 'ru' ? 'Каталог модов для Доты 2' : 'The Dota 2 mod catalog',
      inLanguage: lang,
      isPartOf: { '@id': `${origin}/#website` },
      publisher: { '@id': author['@id'] },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: categories.length,
        itemListElement: categories.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: categoryText(lang, c.id).name,
          url: `${origin}${prefix}/catalog/${c.id}/`,
        })),
      },
    },
  ];
}

export function landingSchema(lang: 'en' | 'ru', origin = 'https://dota2modmanager.com') {
  const url = lang === 'en' ? `${origin}/` : `${origin}/${lang}/`;
  const t = landing[lang];
  const author = authorNode(origin);
  const software = softwareNode(lang, origin);

  /**
   * The name Google prints above a result.
   *
   * It shows "dota2modmanager" there, not "Dota 2 Mod Manager", which is what a domain three
   * weeks old gets by default: the algorithm falls back to the address until enough agrees
   * with it. Everything it reads to decide is stated here and matched by og:site_name, the
   * <title> and the H1 - name, the other names people use, and who publishes it.
   */
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: 'Dota 2 Mod Manager',
    alternateName:
      lang === 'ru'
        ? ['Менеджер модов для Dota 2', 'Мод-менеджер для Доты 2', 'D2MM']
        : ['Dota 2 Mods Manager', 'D2MM'],
    url: `${origin}/`,
    inLanguage: lang,
    publisher: { '@id': author['@id'] },
  };

  /**
   * The clip on the landing, declared.
   *
   * Google will not put a page in the video results for having a <video> tag in it: it wants a
   * name, a description, a thumbnail and a date, and it reads them from here. The search for
   * "dota 2 mod manager" fills its video row with other people's tutorials, and this is the
   * half of the fix that lives on the site. The other half is a video sitemap, in astro.config.
   */
  const video = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: tourText[lang].name,
    description: tourText[lang].description,
    thumbnailUrl: [`${origin}${tourPoster(lang)}`],
    contentUrl: `${origin}${tourUrl(lang)}`,
    uploadDate: TOUR_UPLOADED,
    duration: TOUR_ISO,
    width: TOUR_SIZE.width,
    height: TOUR_SIZE.height,
    encodingFormat: 'video/webm',
    inLanguage: lang,
    isFamilyFriendly: true,
    author: { '@id': author['@id'] },
    publisher: { '@id': author['@id'] },
    embedUrl: url,
  };

  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: t.faq.map(([q, a]) => ({
      '@type': 'Question',
      name: plainText(q),
      acceptedAnswer: { '@type': 'Answer', text: plainText(a) },
    })),
  };

  return [{ '@context': 'https://schema.org', ...author }, software, website, video, faq];
}
