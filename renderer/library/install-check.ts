/* "Why are my mods not in the game", answered in one list: what the app looked at, and for each
 * thing whether it is fine. The most asked question on the Discord, several times a day.
 *
 * The banners over My mods already name every cause the app can see, each with its fix, but they
 * only show when something is wrong. Nothing on the screen said "I looked, and it is all in order",
 * so a person with no banner could not tell whether the app had checked at all, and asked. This is
 * that answer, and what to try when every line is fine. Pure: what the banners know goes in. */
import type { BannersModel } from './model.ts';

export interface CheckLine {
  /** fine, worth knowing, or the reason mods are missing */
  level: 'ok' | 'warn' | 'bad';
  text: string;
}

export interface CheckFacts {
  /** the game path points at Dota */
  gameFound: boolean;
  /** the language folder mods go into */
  folder: string;
  dotaRunning: boolean;
  /** mods switched on, of how many */
  enabled: number;
  total: number;
  slots: number;
  slotCeil: number;
}

export function installChecks(b: BannersModel, f: CheckFacts): CheckLine[] {
  const out: CheckLine[] = [];
  const add = (level: CheckLine['level'], text: string) => out.push({ level, text });

  if (!f.gameFound) {
    add('bad', L`Dota 2 не найдена. Укажи папку игры в настройках, иначе моды ставить некуда.`);
    return out;
  }
  add('ok', L`Dota 2 найдена`);

  if (b.masterOff) add('bad', L`Моды выключены мастер-переключателем внизу справа, игра запустится без них`);
  else if (!f.total) add('warn', L`Модов пока нет: поставь что-нибудь из каталога`);
  else if (!f.enabled) add('bad', L`Все моды выключены по отдельности`);
  else add('ok', L`Включено модов: ${f.enabled} из ${f.total}`);

  if (b.mounted) add('bad', L`Игра читает dota_${b.mounted.mounted}, а моды лежат в dota_${b.mounted.folder}`);
  else if (b.launchLang && !b.launchLang.followed) add('bad', L`В параметрах запуска стоит -language ${b.launchLang.lang}, такую папку игра не читает`);
  else add('ok', L`Моды лежат в dota_${f.folder}, и игра читает эту папку`);

  if (b.stranded.length) add('bad', L`Модов в папках, которые игра не читает: ${b.stranded.reduce((n, s) => n + s.modFiles, 0)}`);
  else add('ok', L`В других языковых папках модов не осталось`);

  if (b.tableOff > 0) add('bad', L`Ждут таблицу предметов: ${b.tableOff}. Без неё эффекты и предметы из конструктора не видны`);
  else add('ok', L`Таблица предметов на месте`);

  if (b.nearLimit) add('warn', L`Занято слотов: ${f.slots} из ${f.slotCeil}. Объедини моды в пак, чтобы влезло больше`);
  else add('ok', L`Занято слотов: ${f.slots} из ${f.slotCeil}`);

  if (b.vanillaBad) add('bad', L`Файл игры не совпадает с подписью Dota. Проверь целостность файлов в Steam`);
  if (b.minify && b.minify.kind === 'warn') add('bad', L`Minify забрал папку, которую читает игра`);
  if (b.foreign) add('warn', L`В gameinfo прописан другой патчер: ${b.foreign}`);
  if (b.repair.state === 'waiting' || b.repair.state === 'failed') add('bad', L`Dota обновилась, а вернуть моды пока не вышло`);
  if (b.conflicts) add('warn', L`Несколько модов меняют один предмет, в игре виден последний`);
  if (b.delisted.length) add('warn', L`Убраны из каталога: ${b.delisted.length}. Если в игре что-то не так, начни с них`);
  if (b.stuck.length) add('bad', L`Проверка файлов Steam вернула оригиналы: ${b.stuck.join(', ')}`);
  if (f.dotaRunning) add('warn', L`Dota запущена: то, что поменялось сейчас, игра увидит после перезапуска`);
  return out;
}

/** What to try next: the banners when there is a reason, the usual three steps when there is none. */
export function checkAdvice(lines: CheckLine[]): string {
  return lines.some((l) => l.level === 'bad')
    ? L`Как исправить, написано над списком модов, у каждой причины своя кнопка.`
    : L`Приложение причин не видит. Если моды всё равно не видны: закрой Dota полностью и запусти снова, потом выключи половину модов, чтобы найти тот, что мешает. Не помогло: отправь отчёт в Discord.`;
}
