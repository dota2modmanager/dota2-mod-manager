// Minimal i18n for the main process (src/).
// Russian is the source language; English strings are keyed by the exact Russian text
// (with {0},{1}... placeholders for interpolated values). A missing key falls back to
// the Russian source, so the app never shows an empty/undefined string.

import ZH_CN from './i18n-zh-CN.ts';

export type Lang = 'en' | 'ru' | 'zh-CN';

let currentLang: Lang = 'en';

export function setLang(lang: unknown): void {
  currentLang = lang === 'ru' || lang === 'zh-CN' ? lang : 'en';
}

export function getLang(): Lang {
  return currentLang;
}

// English dictionary. Key = canonical Russian string with {n} placeholders.
const EN = {
  // ---- errors / dialogs (main process) ----
  'Выбери папку game внутри dota 2 beta': 'Pick the "game" folder inside "dota 2 beta"',
  'В этой папке не найдена Dota 2 (нет подпапки dota)': 'No Dota 2 here (there is no "dota" subfolder)',
  'Уже установлено': 'Already installed',
  'Мод не найден': 'Mod not found',
  'Не указана папка игры': 'No game folder is set',
  'Не тот цвет': 'Not a colour',
  'Этот мод нельзя обновить из каталога': 'This mod cannot be updated from the catalog',
  'Сохранить мод одним .vpk файлом': 'Save the mod as a single .vpk file',
  'Куда распаковать мод': 'Where to unpack the mod',
  'VPK мод': 'VPK mod',
  'Сохранить курсор архивом': 'Save the cursor set as an archive',
  'Архив курсора': 'Cursor archive',
  'Выбери .vpk файлы модов или .zip с ними': 'Pick mod .vpk files, or a .zip holding them',
  'Моды (.vpk, .zip)': 'Mods (.vpk, .zip)',
  'Выбери папку с модами': 'Pick a folder with mods',
  // the two counted passes of an import, shown on the progress bar
  'Копирование модов': 'Copying mods',
  'Разбор модов': 'Reading mods',
  'Нет _dir.vpk для разбора': 'No _dir.vpk to split',
  'В файле меньше двух героев — разбирать нечего': 'Fewer than two heroes in the file — nothing to split',
  'Совпадение с каталогом не найдено': 'No catalog match found',
  'Файл не найден в папке модов': 'That file is not in the mods folder',
  'Мод': 'Mod',
  'У мода нет слота pakNN': 'This mod has no pakNN slot',
  'Папка курсора не найдена': 'Cursor folder not found',
  'Файлы курсора не сохранены — переустанови мод': 'This cursor’s files were not kept — reinstall the mod',
  'Выбери минимум 2 мода (или пак и мод / два пака)': 'Pick at least 2 mods (or a pack and a mod / two packs)',
  'Пак ({0})': 'Pack ({0})',
  'Пак не найден': 'Pack not found',
  'Нет совместимых модов для добавления': 'No compatible mods to add',
  'Мод в паке не найден': 'Mod not found in the pack',
  'Пресет не найден': 'Preset not found',
  'Сохранить пресет для друга': 'Save the preset to share',
  'Пресет Mod Manager': 'Mod Manager preset',
  'Выбери файл пресета (.d2mm)': 'Pick a preset file (.d2mm)',
  'сборка пресета': 'building preset',
  'В пресете нет модов': 'The preset has no mods',
  'Введи название пресета': 'Enter a preset name',
  'В пресете только свои моды — ссылка их не донесёт, отправь файлом':
    'The preset holds only your own mods — a link cannot carry them, send the file',
  'нет в каталоге': 'not in the catalog',
  'нет в каталоге и нечего вложить': 'not in the catalog and there is nothing to embed',
  'файл участника пака не найден': 'the pack member file is missing',
  'отправитель не вложил файл': 'the sender left the file out',
  'файл пресета недоступен': 'the preset file is gone',
  'нет в файле': 'not in the file',
  'В пресете есть свои моды — ссылкой не поделиться, только файлом':
    'This preset has mods of your own — share it as a file, a link cannot carry them',

  // ---- preset-link.js ----
  'Это не похоже на ссылку на пресет': 'That does not look like a preset link',
  'Ссылка слишком длинная': 'The link is too long',
  'Ссылка повреждена': 'The link is damaged',

  // ---- discord-auth.js ----
  'Вход через Discord пока не настроен в этой сборке': 'Discord sign-in is not configured in this build yet',
  'Ответ Discord не совпал с запросом': "Discord's answer did not match the request",
  'Discord не выдал токен': 'Discord returned no token',
  'Вход занял слишком много времени': 'Sign-in took too long',
  'Порт {0} занят — закрой другой вход и попробуй снова': 'Port {0} is busy — close the other sign-in and try again',
  'Discord не отдал профиль (HTTP {0})': 'Discord did not return the profile (HTTP {0})',
  'exe не найден в папке инструмента': 'No .exe found in the tool folder',
  'Инструмент не найден': 'Tool not found',
  'Это не портативная сборка': 'This is not a portable build',
  'Обновления нет': 'There is no update',
  'Файл не найден': 'File not found',
  'По сохранённому пути нет файлов Dota 2 — укажи папку игры заново в настройках': 'The saved path holds no Dota 2 files — set the game folder again in Settings',
  'В этой папке нет файлов Dota 2 — нужна папка game внутри dota 2 beta': 'No Dota 2 files in this folder — pick the game folder inside dota 2 beta',
  'Сохранить отчёт для поддержки': 'Save the support report',
  'Отчёт диагностики': 'Diagnostics report',

  // ---- installer ----
  'Путь к Dota 2 не задан': 'Dota 2 path is not set',
  // ---- item schema / search-path patch ----
  'Закрой Dota 2 перед изменением файлов игры': 'Close Dota 2 before changing game files',
  'Не найден {0}': '{0} not found',
  'items_game.txt не найден в pak01 игры': 'items_game.txt is not in the game\'s pak01',
  'items_game: незакрытая кавычка': 'items_game: unterminated quote',
  'items_game: не найдено открытие блока': 'items_game: no opening brace',
  'items_game: незакрытый блок': 'items_game: unterminated block',
  'items_game: лишняя закрывающая скобка': 'items_game: stray closing brace',
  'items_game: секция items не найдена': 'items_game: no "items" section',
  'items_game: предмет {0} не найден': 'items_game: item {0} not found',
  'items_game: default_item для предмета {0} не найден': 'items_game: no default_item found for item {0}',
  'Без эффекта': 'No effect',
  'Огонь': 'Fire',
  'Молнии': 'Lightnings',
  'Иней': 'Frostbloom',
  'Снег': 'Snow',
  'Пузыри': 'Bubbles',
  'Песчаная буря': 'Sand Storm',
  'Призрак': 'Ghost',
  'второй предмет на тот же слот': 'a second item for the same slot',
  'аркана или персона: конструктор их не меняет': 'an arcana or persona: the builder leaves those alone',
  'для него нет слота в конструкторе': 'the builder has no slot for it',
  'Набор не найден': 'Set not found',
  'items_game: эффект {0} не найден': 'items_game: effect {0} not found',
  'items_game: у предмета {0} нет блока visuals': 'items_game: item {0} has no visuals block',
  'items_game: подозрительно мало предметов ({0})': 'items_game: suspiciously few items ({0})',
  'items_game: предметов меньше, чем в игре ({0} < {1})': 'items_game: fewer items than the game has ({0} < {1})',
  'gameinfo.gi: блок SearchPaths не найден': 'gameinfo.gi: no SearchPaths block',
  'gameinfo.gi: блок SearchPaths не закрыт': 'gameinfo.gi: SearchPaths block is not closed',
  'gameinfo.gi: не найдены строки Game/Mod dota': 'gameinfo.gi: no "Game dota" / "Mod dota" lines',
  'gameinfo_branchspecific.gi: блок FileSystem не найден': 'gameinfo_branchspecific.gi: no FileSystem block',
  'gameinfo_branchspecific.gi: блок FileSystem не закрыт': 'gameinfo_branchspecific.gi: FileSystem block is not closed',
  'Сначала закрой Dota 2 — она держит файлы озвучки открытыми':
    'Close Dota 2 first: it holds the voice files open',
  'HTTP {0} — не удалось скачать {1}': 'HTTP {0} — could not download {1}',
  'Не удалось скачать {0}: {1}': 'Could not download {0}: {1}',
  '{0}: скачанный файл не совпадает с тем, что опубликовал автор мода. Попробуй позже': '{0}: what downloaded is not what the mod\'s author published. Try again later',
  'Эта возможность временно отключена': 'This is switched off for now',
  'перекачиваю повреждённый файл': 'the cached file was damaged, downloading again',
  'Свободных слотов pakNN не осталось (30-99 заняты)': 'No free pakNN slots left (30-99 are taken)',
  'установка': 'installing',
  '{0}: в архиве не найдено assets/custom': '{0}: no assets/custom found in the archive',
  '{0}: в архиве не найдена папка cursor': '{0}: no cursor folder found in the archive',
  'Неизвестный root: {0}': 'Unknown root: {0}',
  'У этого мода нет _dir.vpk — объединять нечего': 'This mod has no _dir.vpk — nothing to merge',
  'У этого мода нет _dir.vpk — распаковывать нечего': 'This mod has no _dir.vpk — nothing to unpack',
  'не .vpk файл': 'not a .vpk file',
  'нет {0}_dir.vpk рядом с data-частями': 'no {0}_dir.vpk next to the data parts',
  'в папке нет ни .vpk, ни файлов игры': 'this folder holds neither a .vpk nor any game files',
  'Папка слишком большая, чтобы собрать её в один VPK': 'This folder is too big to pack into one VPK',
  'В папке нет файлов': 'There are no files in this folder',
  'в архиве нет .vpk файлов': 'no .vpk files in this archive',
  'Курсор': 'Cursor',

  'Пустой VPK': 'Empty VPK',

  // ---- safe-zip.js (a foreign archive turned down) ----
  'архив': 'archive',
  '{0}: архив слишком большой': '{0}: the archive is too large',
  '{0}: архив повреждён или не докачан': '{0}: the archive is damaged or did not finish downloading',
  '{0}: файл {1} в архиве повреждён': '{0}: {1} inside the archive is damaged',
  '{0}: в архиве слишком много файлов': '{0}: too many files in the archive',
  '{0}: файл в архиве слишком большой': '{0}: a file inside the archive is too large',
  '{0}: архив распакуется в слишком большой объём': '{0}: the archive would unpack to too much data',
  '{0}: архив сжат подозрительно плотно': '{0}: the archive is compressed suspiciously tight',
  'Недопустимый путь в архиве: {0}': 'Bad path inside the archive: {0}',

  // ---- preset-share.js (.d2mm validation) ----
  'preset.json повреждён': 'preset.json is damaged',
  'Это не файл пресета Mod Manager': 'This is not a Mod Manager preset file',
  'Файл собран более новой версией приложения': 'The file was made by a newer version of the app',
  'Слишком много модов в пресете': 'Too many mods in the preset',
  'Файл не открывается как пресет': 'The file cannot be opened as a preset',
  'Недопустимое имя файла в архиве': 'Bad file name inside the archive',
  'файла нет в архиве': 'the file is not in the archive',
  'Пресет': 'Preset',

  // ---- discord-presence.js (status text friends see) ----
  'Смотрит каталог модов': 'Browsing the mod catalog',
  'В своей библиотеке': 'In their mod library',
  'Собирает пресет': 'Putting a preset together',
  'В инструментах': 'In the tools',
  'Читает гайды': 'Reading the guides',
  'В настройках': 'In the settings',
  '{0} модов включено': '{0} mods enabled',
  'Ещё без модов': 'No mods yet',
  'Моды выключены': 'Mods turned off',
  'Скачать Mod Manager': 'Get Mod Manager',

  // ---- vpk (parse errors + content labels) ----
  'VPK: незакрытая строка в дереве': 'VPK: unterminated string in the tree',
  'VPK: неверная сигнатура': 'VPK: bad signature',
  'VPK: повреждённое дерево': 'VPK: damaged tree',
  // slot labels
  'голова': 'head', 'голова (2)': 'head (2)', 'волосы': 'hair', 'оружие': 'weapon', 'оружие (2)': 'weapon (2)', 'доп. оружие': 'offhand weapon', 'щит': 'shield', 'броня': 'armor',
  'плечи': 'shoulders', 'шея': 'neck', 'пояс': 'belt', 'руки': 'arms', 'перчатки': 'gloves', 'спина': 'back', 'крылья': 'wings', 'хвост': 'tail',
  'ноги': 'legs', 'ездовое': 'mount', 'костюм': 'costume', 'эффекты': 'effects', 'способность 1': 'ability 1', 'способность 2': 'ability 2',
  'способность 3': 'ability 3', 'способность 4': 'ability 4', 'ультимейт': 'ultimate', 'призыв': 'summon', 'голос': 'voice',
  'форма': 'shapeshift', 'база героя': 'hero base', 'разное': 'misc', 'модель': 'model',
  'перекраска': 'recolor',
  // kind labels (short)
  'варды': 'wards', 'курьер': 'courier', 'интерфейс': 'UI', 'звуки': 'sounds', 'террейн': 'terrain',
  // kind names (title-case)
  'Варды': 'Wards', 'Курьер': 'Courier', 'Интерфейс меню': 'Menu UI', 'Звуки': 'Sounds', 'Ландшафт': 'Terrain',
  'Сборка · {0} героев': 'Bundle · {0} heroes',
} satisfies Record<string, string>;

/** The table as a lookup: any Russian string, its English or nothing. */
const EN_BY_RU: Readonly<Record<string, string | undefined>> = EN;
const ZH_BY_RU: Readonly<Record<string, string | undefined>> = ZH_CN;

function fill(tmpl: string, values: unknown[]): string {
  return tmpl.replace(/\{(\d+)\}/g, (_, i) => (values[+i] != null ? String(values[+i]) : ''));
}

// t('Мод не найден') or t('HTTP {0} — не удалось скачать {1}', status, name)
export function t(ru: string, ...values: unknown[]): string {
  const translated = currentLang === 'zh-CN' ? (ZH_BY_RU[ru] ?? EN_BY_RU[ru]) : EN_BY_RU[ru];
  const tmpl = currentLang !== 'ru' && translated != null ? translated : ru;
  return values.length ? fill(tmpl, values) : tmpl;
}

