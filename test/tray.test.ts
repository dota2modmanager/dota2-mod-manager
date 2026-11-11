/* The app in the tray (src/tray.ts, plan item 9).
 *
 * The promise: while the setting is on (the default), closing the window hides it and the tray
 * icon is there to bring it back or quit; a quit really quits; with the setting off the window
 * closes as it always did and there is no icon. Windows starts it at sign-in only from an
 * installed build, and the uninstaller's run waits for a copy in the tray to let go. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKGROUND_ARG, keepInTray, lockOnceFreed, setLoginItem, startedHidden } from '../src/tray.ts';

function stand(stored: Record<string, unknown> = {}) {
  const kept = new Map(Object.entries(stored));
  const settings = { get: (k: string) => kept.get(k), set: (k: string, v: unknown) => { kept.set(k, v); } } as never;
  const events: Record<string, (e?: unknown) => void> = {};
  const log: string[] = [];
  const trays: { destroyed: boolean; balloons: number; menu: unknown; clicks: Record<string, () => void> }[] = [];
  const win = {
    on: (ev: string, fn: (e: unknown) => void) => { events[`win:${ev}`] = fn as never; },
    hide: () => { log.push('hide'); }, show: () => { log.push('show'); }, focus: () => { log.push('focus'); }, restore: () => { log.push('restore'); },
    isMinimized: () => false, isDestroyed: () => false,
  };
  const app = { on: (ev: string, fn: () => void) => { events[`app:${ev}`] = fn; }, quit: () => log.push('quit') };
  const tray = keepInTray({
    app, win: win as never, settings, t: (s) => s, play: () => log.push('play'),
    menu: (items) => items,
    makeTray: () => {
      const tr = { destroyed: false, balloons: 0, menu: null as unknown, clicks: {} as Record<string, () => void> };
      trays.push(tr);
      return {
        setToolTip: () => {}, setContextMenu: (m: unknown) => { tr.menu = m; }, on: (ev: string, fn: () => void) => { tr.clicks[ev] = fn; },
        displayBalloon: () => { tr.balloons++; }, destroy: () => { tr.destroyed = true; },
      };
    },
  });
  const close = () => { let prevented = false; events['win:close']({ preventDefault: () => { prevented = true; } }); return prevented; };
  return { tray, trays, log, kept, close, events };
}

test('on by default: closing hides the window, said once, and the icon brings it back or quits', () => {
  const s = stand();
  assert.equal(s.trays.length, 1);
  assert.equal(s.close(), true);
  assert.equal(s.close(), true);
  assert.deepEqual(s.log, ['hide', 'hide']);
  assert.equal(s.trays[0].balloons, 1, 'the note comes the first time only');
  assert.equal(s.kept.get('trayHintSeen'), true);

  s.trays[0].clicks.click();
  assert.deepEqual(s.log.slice(2), ['show', 'focus']);
  const menu = s.trays[0].menu as { label?: string; click?: () => void }[];
  assert.deepEqual(menu.map((m) => m.label), ['Открыть', 'Играть', undefined, 'Выйти']);
  menu[1].click!();
  menu[3].click!();
  assert.deepEqual(s.log.slice(-2), ['play', 'quit']);

  s.events['app:before-quit']();
  assert.equal(s.close(), false, 'a quit closes the window for real');
});

test('off: the window closes, and the switch takes the icon away and puts it back', () => {
  const s = stand({ runInBackground: false });
  assert.equal(s.trays.length, 0);
  assert.equal(s.close(), false);

  s.kept.set('runInBackground', true);
  s.tray.sync();
  assert.equal(s.trays.length, 1);
  s.kept.set('runInBackground', false);
  s.tray.sync();
  assert.equal(s.trays[0].destroyed, true);
});

test('Windows starts it hidden, only from an installed build, and the uninstaller waits for the lock', async () => {
  assert.equal(startedHidden(['app.exe', BACKGROUND_ARG]), true);
  assert.equal(startedHidden(['app.exe']), false);

  const calls: unknown[] = [];
  const app = { setLoginItemSettings: (x: unknown) => calls.push(x) };
  setLoginItem(app, true, { allowed: false });
  assert.deepEqual(calls, [], 'a dev run or a sandbox never registers itself');
  setLoginItem(app, false, { allowed: true });
  assert.deepEqual(calls, [{ openAtLogin: false, args: [BACKGROUND_ARG], name: 'Dota 2 Mod Manager' }]);

  let asked = 0;
  assert.equal(await lockOnceFreed({ requestSingleInstanceLock: () => ++asked >= 3 }, { everyMs: 1 }), true);
  assert.equal(await lockOnceFreed({ requestSingleInstanceLock: () => false }, { tries: 3, everyMs: 1 }), false);
});
