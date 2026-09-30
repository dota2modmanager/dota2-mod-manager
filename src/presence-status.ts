/* What the user's Discord profile says while the app is open: which screen they are on, and how
 * many mods are switched on.
 *
 * The status is written in the language the user chose for the app. Their friends read it, and
 * that is the only language signal we have about them. The connection itself is
 * src/discord-presence.ts; this decides what it says and when it is on at all.
 */
import { t } from './i18n.ts';
import type { Activity, DiscordPresence } from './discord-presence.ts';
import type { Settings } from './settings.ts';
import type { Library } from './library.ts';
import type { Installer } from './installer.ts';

/** The first line of the status for each screen the window reports. */
export const PRESENCE_VIEWS: Record<string, string> = {
  catalog: 'Смотрит каталог модов',
  library: 'В своей библиотеке',
  presets: 'Собирает пресет',
  cosmetics: 'Выбирает косметику',
  tools: 'В инструментах',
  guides: 'Читает гайды',
  settings: 'В настройках',
};

/**
 * The status for one moment: the screen, and what is loading.
 * @param mods       switched-on mods
 * @param masterOff  the master switch is off, so nothing loads whatever the records say
 */
export function presenceActivity({ view, mods, masterOff }: { view: string; mods: number; masterOff: boolean }): Activity {
  let state = t('Ещё без модов');
  if (masterOff) state = t('Моды выключены');
  else if (mods) state = t('{0} модов включено', mods);
  return {
    details: t(PRESENCE_VIEWS[view] || PRESENCE_VIEWS.catalog),
    state,
    buttons: [{ label: t('Скачать Mod Manager'), url: 'https://dota2modmanager.com/' }],
  };
}

/** The status kept in step with the app: the setting that turns it off, and the screen it names. */
export function createPresenceStatus({ presence, settings, library, installer }: {
  presence: Pick<DiscordPresence, 'enabled' | 'set' | 'start' | 'stop'>;
  settings: Pick<Settings, 'get'>;
  library: Pick<Library, 'list'>;
  installer: Pick<Installer, 'masterIsOff'>;
}) {
  let view = 'catalog';

  function current(): Activity {
    let mods = 0;
    let masterOff = false;
    try {
      mods = library.list().filter((r) => r.enabled).length;
      // the master switch renames files rather than clearing each record's own flag, so the
      // per-mod count still reads "on" while nothing is actually loading
      masterOff = installer.masterIsOff();
    } catch { /* no library or no game path yet */ }
    return presenceActivity({ view, mods, masterOff });
  }

  /** Say what is true now, if the status is on at all. */
  function refresh(): void {
    if (presence.enabled) presence.set(current());
  }

  /** Follow the setting: turning it off tears the connection down, not just the updates. */
  function apply(): void {
    if (settings.get('discordPresence') === false) { presence.stop(); return; }
    presence.start();
    refresh();
  }

  /** The screen the window says it is showing. */
  function setView(next: string): void {
    view = next;
  }

  return { refresh, apply, setView };
}
