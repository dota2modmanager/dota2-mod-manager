/* A stand-in for Electron under the main-process modules, for tests that run them the way the
 * app does: IPC channels called like the window calls them, a window opened and poked.
 *
 * The modules ask for Electron when they run, through require (src/electron.ts). So the stand-in
 * goes in front of require for exactly that call, and the module itself is imported like any
 * other, with no module cache to clear between tests.
 */
import Module from 'node:module';

/** A channel's handler, called as the window's invoke would: an event, then the arguments. */
export type Handler = (event: unknown, ...args: any[]) => any;

type Loader = { _load: (this: unknown, request: string, ...rest: unknown[]) => unknown };

/** Run `fn` with `fake` answering every require('electron') made while it runs. */
export function withElectron<T>(fake: Record<string, unknown>, fn: () => T): T {
  const loader = Module as unknown as Loader;
  const load = loader._load;
  loader._load = function stubbed(request, ...rest) {
    return request === 'electron' ? fake : load.call(this, request, ...rest);
  };
  try {
    return fn();
  } finally {
    loader._load = load;
  }
}

/**
 * Run `register` with a fake Electron standing in for the real one, and hand back the channels
 * it registered. `electron` adds to or replaces the parts a test needs: a dialog that answers,
 * an app with a version.
 */
export function registerAgainst(register: () => void, electron: Record<string, unknown> = {}): Map<string, Handler> {
  const channels = new Map<string, Handler>();
  withElectron({
    ipcMain: {
      handle: (channel: string, fn: Handler) => channels.set(channel, fn),
      on: (channel: string, fn: Handler) => channels.set(channel, fn),
    },
    app: {}, dialog: {}, shell: {},
    ...electron,
  }, register);
  return channels;
}
