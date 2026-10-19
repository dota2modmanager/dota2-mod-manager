/**
 * Which picture of the app goes in which guide, and what it says, in both languages.
 *
 * The pictures are site/public/guides/<shot>-<lang>.webp, taken by the app itself in the sandbox
 * (npm run guide-shots, tools/guide-shots.mjs): a Russian guide shows the Russian window. Each one
 * goes into the section `after` names, under that section's steps, or its first paragraph when it
 * has no steps, so it sits where the text says what to press. The guides' own text stays as it is.
 */
export type ShotName = 'mod-window' | 'my-mods' | 'safe-mode' | 'safe-confirm' | 'terrains' | 'announcers' | 'tools' | 'cosmetics';

export interface DocShot {
  /** the h2 id of the section it belongs to */
  after: string;
  shot: ShotName;
  caption: { en: string; ru: string };
}

export const docShots: Record<string, DocShot[]> = {
  install: [
    {
      after: 'app', shot: 'mod-window',
      caption: { en: "A mod's window in the catalog. Install puts it in the game.", ru: 'Окно мода в каталоге. «Установить» ставит его в игру.' },
    },
    {
      after: 'remove', shot: 'my-mods',
      caption: { en: 'My mods: the switch turns a mod off, Delete takes it out.', ru: '«Мои моды»: переключатель выключает мод, «Удалить» убирает его совсем.' },
    },
  ],
  uninstall: [
    {
      after: 'one', shot: 'my-mods',
      caption: { en: 'Every installed mod in My mods, with its switch and Delete.', ru: 'Каждый поставленный мод в «Моих модах», с переключателем и кнопкой «Удалить».' },
    },
    {
      after: 'reset', shot: 'safe-mode',
      caption: { en: 'The bar at the bottom of the window. Safe mode on means the game files are as they were.', ru: 'Полоса внизу окна. Безопасный режим включён: файлы игры такие, какими были.' },
    },
  ],
  safe: [
    {
      after: 'methods', shot: 'safe-confirm',
      caption: { en: 'What the app says before it turns safe mode off: the two files it will change, and that it keeps the originals.', ru: 'Что приложение говорит перед выключением безопасного режима: какие два файла оно поменяет и что оригиналы сохранит.' },
    },
  ],
  cosmetics: [
    {
      after: 'what', shot: 'cosmetics',
      caption: { en: 'With safe mode off, the catalog lists looks for your default items. Here, the weather.', ru: 'С выключенным безопасным режимом в каталоге появляются виды для стандартных предметов. Здесь погода.' },
    },
  ],
  terrain: [
    {
      after: 'app', shot: 'terrains',
      caption: { en: 'Terrains in the catalog, each with a preview of the map.', ru: 'Ландшафты в каталоге, у каждого превью карты.' },
    },
  ],
  announcer: [
    {
      after: 'mod', shot: 'announcers',
      caption: { en: 'Announcers in the catalog.', ru: 'Анонсеры в каталоге.' },
    },
  ],
  catalog: [
    {
      after: 'link', shot: 'tools',
      caption: { en: "The catalog's Tools section, inside the app.", ru: 'Раздел «Инструменты» каталога, прямо в приложении.' },
    },
  ],
  'own-mods': [
    {
      after: 'vpk', shot: 'my-mods',
      caption: { en: 'Import VPK and Import folder are at the top of My mods.', ru: '«Импорт VPK» и «Импорт папки» наверху «Моих модов».' },
    },
  ],
};
