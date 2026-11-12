/* Where "What do I do?" on an error leads (issue #424). Every error toast offers the site's
 * troubleshooting guide, and jumps to the part of it that fits when the message names something
 * the guide has a section for. The message reaches the window already in the user's language, so
 * the words are matched in each language the app speaks; a message that names nothing gets the
 * top of the guide, which is still the right page. Kept apart from the toast so it can be tested
 * without a window (test/error-help.test.ts). */

const SITE = 'https://dota2modmanager.com/';

/** A section of /docs/troubleshooting/ and the words that point at it, in Russian, English and Chinese. */
const SECTIONS: Array<[anchor: string, words: RegExp]> = [
  ['workshop-tools', /Workshop Tools/i],
  ['patch', /обновлен|патч|update|patch|更新|补丁/i],
  ['crash', /не запуска|вылета|crash|won't start|will not start|does not start|崩溃|无法启动/i],
  ['conflict', /конфликт|перекрыва|conflict|covered|冲突|覆盖/i],
  ['nothing', /не видно|ничего не измен|nothing changed|not in the game|没有变化|没有生效/i],
];

/** The error asks for the Workshop Tools, which one click in Steam gets closer: the toast offers it. */
export const needsWorkshopTools = (message: string): boolean => /Workshop Tools/i.test(message);

/** The guide's address for this error, in the site's language for the app's. */
export function errorHelpUrl(message: string, lang: string): string {
  const base = `${SITE}${lang === 'ru' ? 'ru/' : ''}docs/troubleshooting/`;
  const hit = SECTIONS.find(([, words]) => words.test(message));
  return hit ? `${base}#${hit[0]}` : base;
}
