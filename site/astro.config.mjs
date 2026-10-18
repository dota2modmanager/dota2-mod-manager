// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { docs, docsIndex } from './src/i18n/docs.ts';
import { facts } from './src/i18n/facts.ts';
import {
  shotNames,
  shotUrl,
  shotAlt,
  shotTitle,
  tourUrl,
  tourPoster,
  tourText,
  TOUR_SECONDS,
  TOUR_UPLOADED,
} from './src/lib/media.ts';
import { ogPath } from './src/lib/og.ts';
import { heroCopy } from './src/i18n/heroes.ts';
import { categoryText } from './src/i18n/categories.ts';
import { catalog } from './src/lib/catalog.ts';
import { modText } from './src/lib/mods.ts';
import heroData from './src/data/heroes.json' with { type: 'json' };
import categoryData from './src/data/categories.json' with { type: 'json' };

const heroBySlug = new Map(heroData.heroes.map((h) => [h.slug, h]));
const categoryById = new Map(categoryData.categories.map((c) => [c.id, c]));
const modByKey = new Map(catalog.map((m) => [m.key, m]));

/**
 * dota2modmanager.com
 *
 * English lives at the root and Russian under /ru/, because the app's own audience is split
 * the same way and English is what a search engine and a stranger land on first. The default
 * locale carries no prefix, so the address people share is the short one.
 *
 * The site is static: Cloudflare Pages serves the built folder and nothing runs on a server.
 */
const SITE = 'https://dota2modmanager.com';
const abs = (p) => `${SITE}${p}`;

/** "/ru/docs/vpk/" -> ["ru", "/docs/vpk/"]; anything else is English at the root. */
function split(url) {
  const p = new URL(url).pathname;
  return p === '/ru/' || p.startsWith('/ru/') ? ['ru', p.slice(3) || '/'] : ['en', p];
}

/** The words that belong to a page's own preview card. */
function cardText(lang, path) {
  if (path === '/') {
    return {
      title: 'Dota 2 Mod Manager',
      caption: lang === 'ru' ? 'Мод-менеджер для Доты 2' : 'A mod manager for Dota 2',
    };
  }
  if (path === '/docs/') return { title: docsIndex[lang].h1, caption: docsIndex[lang].description };
  if (path === '/facts/') return { title: facts[lang].h1, caption: facts[lang].description };
  if (path === '/heroes/') return { title: heroCopy[lang].indexH1, caption: heroCopy[lang].indexDescription };
  if (path === '/catalog/') return { title: lang === 'ru' ? 'Каталог модов для Доты 2' : 'The Dota 2 mod catalog', caption: '' };
  const doc = docs[lang][path.split('/')[2]];
  return doc ? { title: doc.h1, caption: doc.description } : null;
}

export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  /* A content security policy on every page, with the hashes of the page's own scripts and styles
     worked out by Astro at build time, so nothing but those runs. The rest is what the pages really
     load: their own files, the catalog's pictures from wherever a preview lives (the shared-build
     page shows any catalog mod), and two addresses the shared-build page and nothing else fetches.
     frame-ancestors cannot go in a <meta>; it is in public/_headers with the other headers. */
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https:",
        "media-src 'self' https:",
        "connect-src 'self' https://raw.githubusercontent.com https://api.github.com",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
  /* No colouring of code in markdown. Shiki colours a block with style="" on every element, and the
     policy above refuses those, so a highlighted block came out as bare text. The one block the
     markdown pages carry is a shell command; lib/legal.ts gives it the docs' code style instead. */
  markdown: { syntaxHighlight: false },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ru'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', ru: 'ru' },
      },
      /**
       * Say out loud what is on each page besides words.
       *
       * A sitemap listing fourteen addresses tells an image crawler nothing about the pictures
       * on them, and Google Images had three results for this site because three was most of
       * what it had found. Every page now submits its own preview card, the landing submits the
       * three screenshots and the clip, and each one arrives with a title and a caption in the
       * language of the page it belongs to.
       *
       * The `img` and `video` fields are not in @astrojs/sitemap's narrowed type, but the item
       * goes straight to the `sitemap` package underneath, which is what defines them.
       */
      serialize(item) {
        const [lang, path] = split(item.url);

        // A hero page's pictures are the page. Each one goes in with the mod's own name and a
        // caption naming the hero, which is the only thing an image search has to place it by.
        const heroMatch = /^\/heroes\/([^/]+)\/$/.exec(path);
        if (heroMatch) {
          const hero = heroBySlug.get(heroMatch[1]);
          if (hero) {
            item.img = hero.mods
              .filter((m) => m.image)
              .map((m) => ({
                url: abs(m.image.src),
                title: m.name,
                caption: heroCopy[lang].alt.replace('{mod}', m.name).replace('{hero}', hero.name),
              }));
          }
          return item;
        }

        // A mod's page: the mod in each of its styles, captioned with the page's own title.
        const modMatch = /^\/mods\/([^/]+)\/$/.exec(path);
        if (modMatch) {
          const mod = modByKey.get(modMatch[1]);
          if (mod) {
            const caption = modText(lang, mod).title;
            item.img = mod.looks
              .filter((l) => l.img)
              .map((l) => ({ url: abs(l.img), title: l.label ? `${mod.name} (${l.label})` : mod.name, caption }));
          }
          return item;
        }

        const catMatch = /^\/catalog\/([^/]+)\/$/.exec(path);
        if (catMatch) {
          const cat = categoryById.get(catMatch[1]);
          if (cat) {
            const name = categoryText(lang, cat.id).name;
            item.img = cat.mods
              .filter((m) => m.image)
              .map((m) => ({ url: abs(m.image.src), title: m.name, caption: `${m.name}: ${name}` }));
          }
          return item;
        }

        const card = cardText(lang, path);

        const img = card
          ? [{ url: abs(ogPath(lang, path)), title: card.title, caption: card.caption }]
          : [];

        if (path === '/') {
          for (const name of shotNames) {
            img.push({
              url: abs(shotUrl(lang, name)),
              title: shotTitle[lang][name],
              caption: shotAlt[lang][name],
            });
          }
          item.video = [
            {
              thumbnail_loc: abs(tourPoster(lang)),
              title: tourText[lang].name,
              description: tourText[lang].description,
              content_loc: abs(tourUrl(lang)),
              duration: TOUR_SECONDS,
              publication_date: TOUR_UPLOADED,
              family_friendly: 'yes',
              live: 'no',
            },
          ];
        }

        if (img.length) item.img = img;
        return item;
      },
    }),
  ],
  build: { format: 'directory' },
});
