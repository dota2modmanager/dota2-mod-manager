/**
 * The downloads map's words. {total}, {countries} and {cities} are filled at build time from
 * the counter (src/lib/geo.ts), with the noun agreeing in Russian.
 */
export const geo = {
  en: {
    title: 'Where mods get downloaded',
    description: 'A map of where Dota 2 mods from the Dota2PornFx catalog are downloaded: countries and cities, counted by the catalog itself.',
    h1: 'Where mods get downloaded',
    lead: '{total} of catalog mods, from {countries} and {cities}. Each dot is a city, sized by its downloads.',
    mapLabel: 'World map with a dot for each city that downloaded catalog mods',
    countriesHeading: 'Countries',
    citiesHeading: 'Cities',
    others: 'Other countries',
    source:
      'The numbers come from the download counter of the <a href="https://h6rd.github.io/Dota2PornFxWeb/stats.html" rel="noopener">Dota2PornFx catalog</a>, '
      + 'which counts installs from its site and from this app. They hold a country, a city and a total, nothing about who downloaded. '
      + 'The page is rebuilt with the site, so the figures are as of the last build. '
      + 'What the app sends the counter, and how to switch that off, is in the <a href="~/privacy/#the-download-counter">privacy policy</a>.',
    snapshot: 'The counter could not be reached during this build, so this is the snapshot from {date}.',
    words: { downloads: ['download', 'downloads', 'downloads'], countries: ['country', 'countries', 'countries'], cities: ['city', 'cities', 'cities'] },
  },
  ru: {
    title: 'Где качают моды',
    description: 'Карта загрузок модов Dota 2 из каталога Dota2PornFx: страны и города, по счётчику самого каталога.',
    h1: 'Где качают моды',
    lead: 'Моды из каталога скачали {total} в {countries} и {cities}. Точка - город, чем больше загрузок, тем она крупнее.',
    mapLabel: 'Карта мира, на ней точка для каждого города, где качали моды из каталога',
    countriesHeading: 'Страны',
    citiesHeading: 'Города',
    others: 'Другие страны',
    source:
      'Цифры берутся из счётчика загрузок <a href="https://h6rd.github.io/Dota2PornFxWeb/stats.html" rel="noopener">каталога Dota2PornFx</a>: '
      + 'он считает установки и с его сайта, и из этого приложения. В них только страна, город и число, ничего о том, кто качал. '
      + 'Страница пересобирается вместе с сайтом, так что цифры на момент последней сборки. '
      + 'Что приложение отправляет счётчику и как это выключить, написано в <a href="~/privacy/#счётчик-скачиваний">политике конфиденциальности</a>.',
    snapshot: 'Во время этой сборки счётчик не ответил, поэтому здесь снимок от {date}.',
    words: { downloads: ['раз', 'раза', 'раз'], countries: ['стране', 'странах', 'странах'], cities: ['городе', 'городах', 'городах'] },
  },
} as const;
