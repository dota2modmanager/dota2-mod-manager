/* The switches that let a script drive the window: a screenshot after some clicks (MM_SHOT and
 * the switches around it), a scenario run (MM_SIM) and a recording for the site (MM_REC).
 *
 * None of it does anything unless its variable is set, and a person running the app never sets
 * one. It ships with the build all the same, because the release checks the installer it built by
 * starting it with MM_SHOT and MM_EVAL (tools/e2e.mjs) before anybody downloads it. MM_SIM and
 * MM_REC load their drivers out of tools/, which only a checkout has.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { captureWithRetry } from './capture.ts';
import type { BrowserWindow } from 'electron';

const load = createRequire(import.meta.url);

/** The part of a window the harness drives. */
export type DrivenWindow = Pick<BrowserWindow, 'show' | 'focus'> & {
  webContents: Pick<BrowserWindow['webContents'], 'once' | 'executeJavaScript' | 'sendInputEvent' | 'send' | 'capturePage'>;
};

type Env = Record<string, string | undefined>;
type Wait = (ms: number) => Promise<void>;

const sleep: Wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wire whichever of the switches is set to the window, once its page has loaded.
 * @param appRoot  where tools/ is, for MM_SIM and MM_REC
 * @param quit     ends the app when a recording is done
 */
export function attachDevHarness(win: DrivenWindow, { env = process.env, diag, appRoot, quit, wait = sleep }: {
  env?: Env; diag: (msg: string) => void; appRoot: string; quit: () => void; wait?: Wait;
}): void {
  if (env.MM_SHOT) {
    win.webContents.once('did-finish-load', () => {
      diag('did-finish-load');
      void wait(7000).then(() => takeShot(win, env, { diag, wait }));
    });
  }
  // MM_SIM=<scenarios> drives the window through tools/sim (tools/sim/driver.js attach)
  if (env.MM_SIM) (load(path.join(appRoot, 'tools', 'sim', 'driver')) as { attach(w: DrivenWindow): void }).attach(win);
  // MM_REC=<dir> films the app running a scripted scene, one webm per scene. The site needs a
  // clip of the app working, and a fresh one every release, so it is a script rather than
  // something recorded by hand. MM_SCENE picks scenes by name.
  if (env.MM_REC) {
    win.webContents.once('did-finish-load', () => {
      void wait(9000).then(() => record(win, env, appRoot)).finally(quit);
    });
  }
}

/**
 * Walk the page to the state the switches describe, then save a picture of it at MM_SHOT: the
 * view, the catalog category, a search, clicks, a hover, a drag, wheel ticks, an update bar, a
 * scroll, a mod's card. MM_EVAL reads the finished page and writes the answer beside the picture,
 * because a picture cannot say whether a fold opened with the right text in the right language.
 * Whatever goes wrong is written to MM_SHOT.err.txt instead.
 */
export async function takeShot(win: DrivenWindow, env: Env, { diag, wait = sleep }: { diag: (msg: string) => void; wait?: Wait }): Promise<void> {
  const shot = env.MM_SHOT!;
  const run = (js: string) => win.webContents.executeJavaScript(js);
  diag('capture start');
  try {
    // MM_QUIET=1: the window was created hidden and stays that way, so a run after numbers
    // rather than a picture never jumps in front of whatever the person at the keyboard is doing
    if (!env.MM_QUIET) {
      win.show();
      win.focus();
    }
    if (env.MM_VIEW) {
      await run(`document.querySelector('[data-view="${env.MM_VIEW}"]')?.click()`);
      await wait(2500);
    }
    if (env.MM_CAT) {
      await run(`document.querySelector('.rail-item[data-cat="${env.MM_CAT}"]')?.click()`);
      await wait(2500);
    }
    if (env.MM_SEARCH) {
      // type into the title-bar search (its handler is debounced)
      await run(`(() => {
        const el = document.getElementById('globalSearch');
        if (!el) return;
        el.value = ${JSON.stringify(env.MM_SEARCH)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(2500);
    }
    if (env.MM_CLICK) {
      // CSS selectors split by "||", clicked in order
      for (const sel of env.MM_CLICK.split('||')) {
        await run(`document.querySelector(${JSON.stringify(sel)})?.click()`);
        await wait(700);
      }
    }
    if (env.MM_HOVER) {
      // park the pointer over a selector (or "x,y") so the shot shows the hover state: half of
      // what a card does only exists under the cursor
      const spec = env.MM_HOVER;
      let point: { x: number; y: number } | null = null;
      if (/^\d+\s*,\s*\d+$/.test(spec)) {
        const [x, y] = spec.split(',').map(Number);
        point = { x, y };
      } else {
        point = await run(`(() => {
          const el = document.querySelector(${JSON.stringify(spec)});
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
      }
      if (point) {
        // two moves: the first lands, the second keeps the pointer there after any relayout
        // the first one caused
        win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
        await wait(250);
        win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
        await wait(600);
      }
    }
    if (env.MM_DRAG) {
      // press, move, release: "x1,y1,x2,y2" (drags a grip, swipes a strip)
      const [x1, y1, x2, y2] = env.MM_DRAG.split(',').map(Number);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: x1, y: y1, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 12; i++) {
        win.webContents.sendInputEvent({
          type: 'mouseMove', button: 'left',
          x: Math.round(x1 + ((x2 - x1) * i) / 12), y: Math.round(y1 + ((y2 - y1) * i) / 12),
        } as Electron.MouseInputEvent);
        await wait(30);
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: x2, y: y2, button: 'left', clickCount: 1 });
      await wait(500);
    }
    if (env.MM_WHEEL) {
      // wheel ticks at a point: "x,y,deltaY[,ctrl]", several split by ";"
      for (const spec of env.MM_WHEEL.split(';')) {
        const [x, y, dy, mod] = spec.split(',').map((v) => v.trim());
        win.webContents.sendInputEvent({
          type: 'mouseWheel', x: Number(x), y: Number(y),
          deltaX: 0, deltaY: Number(dy), canScroll: true,
          modifiers: mod === 'ctrl' ? ['control'] : [],
        });
        await wait(400);
      }
    }
    if (env.MM_UPDATE) {
      // MM_UPDATE=portable:2.3.0 raises the update bar without waiting for a real release, so
      // the three states it can be in stay checkable from a screenshot
      const [type, version] = String(env.MM_UPDATE).split(':');
      win.webContents.send('update', { type, version: version || '0.0.0' });
      await wait(900);
    }
    if (env.MM_SCROLL) {
      // scroll the scrollable pane by N px (long views)
      await run(`(() => {
        const el = [...document.querySelectorAll('#main, *')].find((e) =>
          e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        (el || document.scrollingElement).scrollBy(0, ${Number(env.MM_SCROLL) || 0});
      })()`);
      await wait(600);
    }
    if (env.MM_MODAL) {
      await run(`
        [...document.querySelectorAll('.card .card-name')]
          .find(n => n.textContent.trim() === ${JSON.stringify(env.MM_MODAL)})
          ?.closest('.card')?.click()`);
      await wait(1500);
      if (env.MM_PREVIEW) {
        await run(`document.getElementById('previewPlayBtn')?.click()`);
        await wait(2500);
      }
    }
    if (env.MM_EVAL) {
      const out = await run(`(async () => {
        ${env.MM_EVAL}
      })()`);
      fs.writeFileSync(`${shot}.eval.json`, JSON.stringify(out, null, 1));
    }
    await wait(500);
    // a runner's xvfb sometimes has no frame to hand over yet (UnknownVizError): src/capture.ts
    const img = await captureWithRetry(() => win.webContents.capturePage(), { log: diag });
    fs.writeFileSync(shot, img.toPNG());
    diag(`capture done ${img.getSize().width}x${img.getSize().height}`);
  } catch (e) {
    fs.writeFileSync(`${shot}.err.txt`, String(e));
  }
}

/** Film the scenes in tools/screencast-scenes, one webm each, into MM_REC. */
async function record(win: DrivenWindow, env: Env, appRoot: string): Promise<void> {
  const log = (m: string) => process.stdout.write(`${m}\n`);
  type Cast = { setup(): Promise<unknown>; scene(name: string, steps: unknown, log: (m: string) => void): Promise<void>; close(): void };
  let cast: Cast | null = null;
  try {
    const { Cast } = load(path.join(appRoot, 'tools', 'screencast')) as { Cast: new (w: DrivenWindow, o: { out: string }) => Cast };
    const scenes = load(path.join(appRoot, 'tools', 'screencast-scenes')) as Record<string, unknown>;
    win.show();
    win.focus();
    cast = new Cast(win, { out: env.MM_REC! });
    log(`cast ready ${JSON.stringify(await cast.setup())}`);
    const only = env.MM_SCENE ? env.MM_SCENE.split(',') : null;
    for (const [name, build] of Object.entries(scenes)) {
      if (only && !only.includes(name)) continue;
      const steps = typeof build === 'function' ? await build(cast, log) : build;
      await cast.scene(name, steps, log);
    }
  } catch (e) {
    log(`cast failed: ${(e as Error)?.stack || e}`);
  }
  if (cast) cast.close();
}
