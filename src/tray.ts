/* The app beside the game rather than in front of it (plan item 9, Misha's call on 2026-11-12).
 *
 * The app puts the game back after a Dota patch (src/game-repair.ts), but only while it runs: a
 * patch that lands with it closed leaves the old item table in the game, and a launch from Steam
 * fails until the app is opened. So by default it starts with Windows, hidden, and closing the
 * window hides it in the tray instead of quitting. The patch watcher and the game watch keep
 * running in the main process. Settings has the switch (renderer/settings/BackgroundBlock.tsx);
 * off, the app closes when its window does and Windows does not start it.
 *
 * Electron is handed in rather than imported, so the logic runs under plain node in the tests.
 */
import type { Settings } from './settings.ts';

/** The argument Windows starts the app with at sign-in: no window, only the tray. */
export const BACKGROUND_ARG = '--background';
/** The name of the app's line under HKCU\...\Run. */
export const LOGIN_ITEM_NAME = 'Dota 2 Mod Manager';

/** Started by Windows at sign-in rather than by a person. */
export const startedHidden = (argv: readonly string[]) => argv.includes(BACKGROUND_ARG);

/** The setting, on unless turned off. */
export const inBackground = (settings: Pick<Settings, 'get'>) => settings.get('runInBackground') !== false;

type LoginApp = { setLoginItemSettings(s: { openAtLogin: boolean; args?: string[]; name?: string }): void };

/** Ask Windows to start the app at sign-in, or stop asking. A dev run or a sandbox never registers itself. */
export function setLoginItem(app: LoginApp, on: boolean, { allowed }: { allowed: boolean }): void {
  if (!allowed) return;
  app.setLoginItemSettings({ openAtLogin: on, args: [BACKGROUND_ARG], name: LOGIN_ITEM_NAME });
}

type LockApp = { requestSingleInstanceLock(): boolean };

/**
 * The lock, for the run the uninstaller starts. A copy in the tray holds it, and hearing
 * --uninstall it quits (keepInTray's caller), so this waits for that rather than giving up.
 * Without it the removal window never showed while the app sat in the tray.
 */
export function lockOnceFreed(app: LockApp, { tries = 40, everyMs = 250 } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let n = 0;
    const again = () => {
      if (app.requestSingleInstanceLock()) { resolve(true); return; }
      if (++n >= tries) { resolve(false); return; }
      setTimeout(again, everyMs);
    };
    again();
  });
}

type TrayLike = {
  setToolTip(s: string): void; setContextMenu(m: unknown): void; on(ev: 'click' | 'double-click', fn: () => void): void;
  displayBalloon?(o: { title: string; content: string; iconType?: string }): void; destroy(): void;
};
type WinLike = {
  on(ev: 'close', fn: (e: { preventDefault(): void }) => void): void;
  hide(): void; show(): void; focus(): void; restore(): void; isMinimized(): boolean; isDestroyed(): boolean;
};

/**
 * Hide the window in the tray instead of closing it, while the setting is on.
 * @param makeTray  builds the icon (Electron's Tray over build/icon.png)
 * @param menu  builds the right-click menu from its items (Electron's Menu.buildFromTemplate)
 * @param t  the main process's words, read each time the menu is built
 * @param play  what the menu's Play does
 */
export function keepInTray({ app, win, settings, makeTray, menu, t, play, diag = () => {} }: {
  app: { on(ev: 'before-quit', fn: () => void): void; quit(): void };
  win: WinLike;
  settings: Pick<Settings, 'get' | 'set'>;
  makeTray: () => TrayLike;
  menu: (items: { label?: string; type?: 'separator'; click?: () => void }[]) => unknown;
  t: (ru: string) => string;
  play: () => void;
  diag?: (msg: string) => void;
}) {
  let quitting = false;
  let tray: TrayLike | null = null;
  app.on('before-quit', () => { quitting = true; });

  const show = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const fill = () => tray?.setContextMenu(menu([
    { label: t('Открыть'), click: show },
    { label: t('Играть'), click: play },
    { type: 'separator' },
    { label: t('Выйти'), click: () => app.quit() },
  ]));

  /** The icon there while the setting is on, and gone when it is off; the menu in the current language. */
  function sync(): void {
    if (inBackground(settings) && !tray) {
      tray = makeTray();
      tray.setToolTip('Dota 2 Mod Manager');
      tray.on('click', show);
      tray.on('double-click', show);
    } else if (!inBackground(settings) && tray) {
      tray.destroy();
      tray = null;
    }
    fill();
  }

  win.on('close', (e) => {
    if (quitting || !inBackground(settings)) return;
    e.preventDefault();
    win.hide();
    // said once, the first time: a window that vanished without a word reads as a crash
    if (!settings.get('trayHintSeen')) {
      tray?.displayBalloon?.({ title: 'Dota 2 Mod Manager', content: t('Приложение работает в трее и вернёт моды после обновления Доты. Выйти можно правым кликом по значку, отключить в Настройках.'), iconType: 'info' });
      settings.set('trayHintSeen', true);
    }
    diag('window hidden in the tray');
  });

  sync();
  return { sync, show, quitting: () => quitting };
}
