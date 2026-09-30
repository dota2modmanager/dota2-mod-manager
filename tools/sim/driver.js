/**
 * Simulation driver: runs scenarios against the real window, the way a person would, and writes
 * down what they would have seen.
 *
 * The input is real. Pointer moves, clicks and wheel ticks go through sendInputEvent, so hover
 * states, handlers and scrolling behave as they do under a hand; nothing is clicked through the
 * DOM behind the page's back. Coordinates are window pixels, converted from CSS pixels with a
 * ratio measured from the window rather than assumed, because the app scales itself and a
 * profile may force a device scale factor on top.
 *
 * Every scenario writes checks (a name, whether it held, and why not) and pictures, and the run
 * ends with results.json beside them: the machine it ran on as the GPU process describes it, the
 * window and the work area it had, and every check. tools/sim/run.mjs reads that file.
 *
 * Dev-only. src/dev-harness.ts loads this only when MM_SIM is set, and it lives under tools/,
 * which the installer does not carry.
 */
const { app, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { compareFrames, markChanges } = require('./frames');
const { fitsWorkArea } = require('./fit');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A value written into code the page runs. JSON.stringify leaves characters that end a script
   or a line in some parsers, and CodeQL's js/bad-code-sanitization asks for those escaped too;
   this is the fix its documentation gives. Scenarios put catalog names into page code with it. */
const UNSAFE = {
  '<': '\\u003C', '>': '\\u003E', '/': '\\u002F', '\\': '\\\\', '\b': '\\b', '\f': '\\f',
  '\n': '\\n', '\r': '\\r', '\t': '\\t', '\0': '\\0', '\u2028': '\\u2028', '\u2029': '\\u2029',
};
const lit = (v) => JSON.stringify(v).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (c) => UNSAFE[c]);

class Sim {
  /**
   * @param {import('electron').BrowserWindow} win
   * @param {{ out: string, scenario?: string }} opts
   */
  constructor(win, { out, scenario = 'run' }) {
    this.win = win;
    this.out = out;
    this.scenario = scenario;
    this.checks = [];
    this.pictures = [];
    this.scale = 1;
    this.x = 20;
    this.y = 20;
    fs.mkdirSync(out, { recursive: true });
  }

  js(expr) { return this.win.webContents.executeJavaScript(expr); }

  /** Polls an expression in the page until it is truthy, and returns its value, or null on timeout. */
  async until(expr, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
      // awaited in the page, so an expression can be a call into window.api and not only the DOM
      const v = await this.js(`(async () => { try { return await (${expr}); } catch { return null; } })()`);
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(200);
    }
  }

  /**
   * A window minimized under the run has no size: getContentSize() says [0, 0], every position
   * worked out from it comes to 0 / 0, and the page is handed NaN for a point. On a machine
   * somebody is using that is Win+D or a click on the taskbar, and it failed whole runs with
   * "elementFromPoint: non-finite" in whatever scenario was going. A hand would bring the
   * window back before touching it, so this does, and says so in the log.
   */
  async awake() {
    if (!this.win.isMinimized() && this.win.getContentSize()[0] > 0) return;
    process.stdout.write('sim: the window was minimized from outside the run; restored\n');
    this.win.restore();
    this.win.show();
    await sleep(600);
  }

  /** Whether the page is ready to be used: the catalog drawn, the settings read, no dialog up. */
  async ready() {
    await this.awake();
    const [cw] = this.win.getContentSize();
    this.scale = cw / (await this.js('window.innerWidth'));
    await this.until(`document.querySelector('.rail-item[data-cat]')`, 30000);
    // every scenario starts where the app opens: on the catalog, with no window over it,
    // whatever the one before it left on screen
    if (await this.js(`!document.getElementById('modalOverlay').classList.contains('hidden')`)) {
      await this.key('Escape');
      await this.until(`document.getElementById('modalOverlay').classList.contains('hidden')`, 3000);
    }
    if (await this.js(`document.querySelector('.tb-tab.active')?.dataset.view !== 'catalog'`)) {
      await this.click('.tb-tab[data-view="catalog"]');
      await this.until(`document.querySelector('.tb-tab.active')?.dataset.view === 'catalog'
        && !document.documentElement.classList.contains('vt-screen')`, 8000);
    }
    const blocking = await this.js(`[...document.querySelectorAll('.confirm-overlay, .lang-pick-overlay')].map((d) => d.textContent.trim().slice(0, 80))`);
    this.check('the window opens on the catalog with nothing in front of it', !blocking.length, blocking.join(' | '));
    return { scale: this.scale };
  }

  check(name, ok, detail = '', data) {
    const entry = { scenario: this.scenario, name, ok: Boolean(ok), detail: ok ? '' : String(detail || '') };
    if (data !== undefined) entry.data = data;
    this.checks.push(entry);
    process.stdout.write(`${entry.ok ? 'ok  ' : 'FAIL'} ${this.scenario}: ${name}${entry.ok ? '' : ` - ${entry.detail}`}\n`);
    return entry.ok;
  }

  // ---- input -------------------------------------------------------------------------------

  /**
   * A selector's centre in window pixels, or null. "sel@3" is the third match. An element
   * scrolled out of sight, or covered (a toast lies over the bottom of the list after every
   * install), is scrolled to the middle first, as a hand would before clicking it: a click at
   * its coordinates would otherwise land on whatever is drawn there instead.
   */
  async find(spec) {
    await this.awake();
    const at = /@(\d+)$/.exec(spec);
    const sel = at ? spec.slice(0, -at[0].length) : spec;
    const box = await this.js(`(async () => {
      const el = document.querySelectorAll(${lit(sel)})[${at ? Number(at[1]) - 1 : 0}];
      if (!el) return null;
      const seen = (r) => {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (hit === el || el.contains(hit));
      };
      let b = el.getBoundingClientRect();
      if ((b.width || b.height) && !seen(b)) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      // Cards off screen are drawn lazily (content-visibility), so the ones scrolled past take
      // their real height over the next frames and the target drifts, by up to 60 px on Heroes.
      // A hand waits for the page to stop moving; so does this, for up to half a second.
      // bounded: a page that stops producing frames must fail a check, not hang the run
      const frame = () => new Promise((r) => { requestAnimationFrame(() => r(undefined)); setTimeout(r, 100); });
      for (let i = 0, last = ''; i < 30; i++) {
        await frame();
        b = el.getBoundingClientRect();
        const now = [b.left, b.top, b.width, b.height].map(Math.round).join();
        if (now === last) break;
        last = now;
        if (!seen(b)) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      return b.width || b.height ? { x: b.left + b.width / 2, y: b.top + b.height / 2, iw: innerWidth } : null;
    })()`);
    if (!box) return null;
    // measured each time: the app's own scale setting changes how many window pixels a CSS pixel is
    const scale = this.win.getContentSize()[0] / box.iw;
    if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(box.x) || !Number.isFinite(box.y)) {
      throw new Error(`find(${spec}): no usable position (${JSON.stringify({ box, content: this.win.getContentSize(), scale })})`);
    }
    this.scale = scale;
    return { x: Math.round(box.x * this.scale), y: Math.round(box.y * this.scale) };
  }

  async move(x, y, steps = 8) {
    for (let i = 1; i <= steps; i++) {
      this.win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(this.x + ((x - this.x) * i) / steps),
        y: Math.round(this.y + ((y - this.y) * i) / steps),
      });
      await sleep(12);
    }
    this.x = x;
    this.y = y;
  }

  /** What is under a window point, and whether it is the element `spec` names or inside it. */
  async under(spec, p) {
    if (![p.x, p.y, this.scale].every(Number.isFinite) || !(this.scale > 0)) throw new Error(`under(${spec}): ${JSON.stringify({ p, scale: this.scale })}`);
    const at = /@(\d+)$/.exec(spec);
    const sel = at ? spec.slice(0, -at[0].length) : spec;
    return this.js(`(() => {
      const el = document.querySelectorAll(${lit(sel)})[${at ? Number(at[1]) - 1 : 0}];
      const hit = document.elementFromPoint(${p.x / this.scale}, ${p.y / this.scale});
      return { on: !!el && !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.id ? '#' + hit.id : hit.className || hit.tagName) : null };
    })()`);
  }

  async click(spec) {
    let p = await this.find(spec);
    if (!p) {
      // a list being redrawn is empty for a moment (the catalog redraws after every install);
      // a hand waits for it to come back rather than clicking at nothing
      const at = /@(\d+)$/.exec(spec);
      const sel = at ? spec.slice(0, -at[0].length) : spec;
      await this.until(`document.querySelectorAll(${lit(sel)}).length >= ${at ? Number(at[1]) : 1}`, 5000);
      p = await this.find(spec);
    }
    if (!p) return false;
    await this.move(p.x, p.y);
    // Aimed, the way a hand is: with the pointer there, is the target under it? Moving takes a
    // tenth of a second, and a list still settling or a toast arriving can move it off.
    for (let i = 0; i < 3; i++) {
      const u = await this.under(spec, p);
      this.lastClick = { spec, x: p.x, y: p.y, hit: u.hit, on: u.on };
      if (u.on) break;
      const again = await this.find(spec);
      if (!again) return false;
      p = again;
      await this.move(p.x, p.y, 2);
    }
    this.win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(60);
    this.win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    return true;
  }

  /** The right button, which is where the app keeps its rare actions (ui/menu.js). */
  async rightClick(spec) {
    const p = await this.find(spec);
    if (!p) return false;
    await this.move(p.x, p.y);
    this.win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'right', clickCount: 1 });
    await sleep(60);
    this.win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'right', clickCount: 1 });
    return true;
  }

  /**
   * Wheel ticks at the pointer, fast: a flick, not a reading pace. dy counts the way the page
   * does, positive down. Chromium's input events count the other way (a wheel rolled away from
   * you is positive and scrolls up), and the first run of this drove eight flicks into the top of
   * the list and compared a page that had not moved.
   */
  async fling(dy, ticks = 8, gap = 16) {
    for (let i = 0; i < ticks; i++) {
      this.win.webContents.sendInputEvent({ type: 'mouseWheel', x: this.x, y: this.y, deltaX: 0, deltaY: -dy, canScroll: true });
      await sleep(gap);
    }
  }

  /** A key press, with modifiers ('control', 'shift', 'alt'), sent the way a keyboard sends it. */
  async key(keyCode, modifiers = []) {
    const wc = this.win.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    // a printable key without Ctrl also types itself, which is what a field listens to
    if (keyCode.length === 1 && !modifiers.includes('control')) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
    await sleep(30);
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(30);
  }

  /** Types text into whatever has focus, one key at a time. */
  async type(text) {
    for (const ch of text) await this.key(ch);
  }

  /**
   * What would stop a person reading the screen: the page scrolling sideways, or a control
   * sticking out of the window. Each is a check with what stuck out and by how much.
   */
  async layout(where) {
    const r = await this.js(`(() => {
      const w = innerWidth, h = innerHeight;
      const out = [];
      for (const el of document.querySelectorAll('button, a, input, select, .card, .tb-tab, .rail-item')) {
        if (el.closest('[hidden], .hidden')) continue;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        // a control inside a scroller is allowed past the edge of the window, as long as its
        // scroller is not: that is what scrolling is for
        let clip = null;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p);
          if (/auto|scroll|hidden|clip/.test(o.overflowX + o.overflowY)) { clip = p; break; }
        }
        if (clip) continue;
        if (b.right > w + 1 || b.left < -1) out.push({ el: el.className || el.tagName, left: Math.round(b.left), right: Math.round(b.right) });
      }
      return { sideways: document.documentElement.scrollWidth - w, out: out.slice(0, 5) };
    })()`);
    this.check(`${where}: the page does not scroll sideways`, r.sideways <= 1, `${r.sideways}px wider than the window`, r);
    this.check(`${where}: no control sticks out of the window`, !r.out.length, JSON.stringify(r.out), r);
  }

  /**
   * Waits for everything that moves on its way somewhere to get there: a window opening, a
   * screen sliding in. A spinner or a shimmer that loops forever is not waited for.
   */
  async still(ms = 3000) {
    return this.until(`document.getAnimations().every((a) => a.playState !== 'running'
      || a.effect?.getComputedTiming().endTime === Infinity)`, ms);
  }

  /**
   * Waits for the pictures on screen to finish loading, then a little more for anything easing in.
   * A part of the page still waiting on an answer from main carries data-awaiting (the old-map
   * mark on a terrain card is one), and is waited for first: an answer landing between the two
   * frames of integrity() changed the picture, and a check that passes or fails by network timing
   * teaches everybody to ignore it.
   */
  async settle(ms = 800) {
    await this.until(`!document.querySelector('[data-awaiting]')`, 8000);
    await this.until(`[...document.querySelectorAll('img')].filter((i) => {
      const b = i.getBoundingClientRect();
      return b.bottom > 0 && b.top < innerHeight && b.width > 0;
    }).every((i) => i.complete)`, 8000);
    await sleep(ms);
  }

  // ---- pictures ----------------------------------------------------------------------------

  async shot(name) {
    const image = await this.win.webContents.capturePage();
    const file = path.join(this.out, `${this.scenario}-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    this.pictures.push(path.basename(file));
    return { file, image };
  }

  /**
   * Whether what is on screen is what the page would draw from scratch (see frames.js). A
   * frame, a forced full repaint, a second frame; a difference is kept as a picture with the
   * changed blocks outlined.
   */
  async integrity(name, { limit = 0.002 } = {}) {
    const first = await this.win.webContents.capturePage();
    this.win.webContents.invalidate();
    await sleep(350);
    const second = await this.win.webContents.capturePage();
    const { width, height } = first.getSize();
    const r = compareFrames(first.toBitmap(), second.toBitmap(), width, height);
    const ok = r.cellShare <= limit;
    const data = { cellShare: Number(r.cellShare.toFixed(5)), changedCells: r.changedCells, boxes: r.boxes.slice(0, 5) };
    if (!ok) {
      const { nativeImage } = require('electron');
      const before = path.join(this.out, `${this.scenario}-${name}-on-screen.png`);
      const marked = path.join(this.out, `${this.scenario}-${name}-repainted-marked.png`);
      fs.writeFileSync(before, first.toPNG());
      fs.writeFileSync(marked, nativeImage.createFromBitmap(markChanges(second.toBitmap(), width, height, r.boxes), { width, height }).toPNG());
      this.pictures.push(path.basename(before), path.basename(marked));
    }
    return this.check(`the screen after ${name} is what the page draws from scratch`, ok,
      `${(r.cellShare * 100).toFixed(2)}% of the screen differs after a repaint, largest block ${JSON.stringify(r.boxes[0] || null)}`, data);
  }

  /** The window against the work area it opened in, honouring the profile's simulated screen. */
  windowFits() {
    const b = this.win.getBounds();
    const fake = /^(\d+)x(\d+)$/.exec(process.env.MM_WORKAREA || '');
    const area = fake ? { x: 0, y: 0, width: Number(fake[1]), height: Number(fake[2]) } : screen.getDisplayMatching(b).workArea;
    // a profile's scale is forced on the machine's own screen, and that rounds sizes (fit.js)
    const forcedScale = app.commandLine.hasSwitch('force-device-scale-factor');
    return this.check('the window fits the work area it opened in', fitsWorkArea(b, area, { forcedScale }),
      `window ${b.width}x${b.height}, work area ${area.width}x${area.height}${forcedScale ? ', scale forced' : ''}`,
      { window: b, workArea: area, forcedScale });
  }
}

/** The machine as Chromium's GPU process sees it, which is what a user's report shows too. */
async function machine() {
  /** @type {any} */
  let gpu = null;
  try { gpu = await app.getGPUInfo('basic'); } catch { /* no GPU process */ }
  return {
    platform: `${process.platform} ${require('os').release()} ${process.arch}`,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    args: process.argv.slice(2).filter((a) => a.startsWith('--') && !a.startsWith('--user-data-dir')),
    gpuFeatures: app.getGPUFeatureStatus(),
    gpuDevices: gpu && gpu.gpuDevice,
    displays: screen.getAllDisplays().map((d) => ({ size: d.size, workArea: d.workArea, scaleFactor: d.scaleFactor, refresh: d.displayFrequency })),
  };
}

/**
 * Runs the scenarios named in `list` (comma separated, files in ./scenarios) one after another
 * in the same window, and writes results.json. A scenario that throws is a failed check, not a
 * dead run: the rest still get their turn.
 */
/** @param {import('electron').BrowserWindow} win @param {string} list @param {{ out: string }} opts */
async function run(win, list, { out }) {
  const started = Date.now();
  const all = { checks: [], pictures: [] };
  // What the page said while it was being used. An exception in a click handler leaves the
  // screen looking fine and the button doing nothing, and only the console knows.
  let said = [];
  const listen = (/** @type {any} */ e, /** @type {any} */ level, /** @type {any} */ message, /** @type {any} */ line, /** @type {any} */ source) => {
    // Electron 35 moved the fields onto the event; older builds pass them as arguments
    const lvl = typeof level === 'number' ? ['debug', 'info', 'warning', 'error'][level] : e.level;
    const text = typeof message === 'string' ? message : e.message;
    // where it was thrown, so a report names the file and not just the words
    const at = `${String((typeof source === 'string' ? source : e.sourceId) || '').split('/').slice(-2).join('/')}:${typeof line === 'number' ? line : e.lineNumber}`;
    if (lvl === 'error') said.push(`${String(text).slice(0, 300)} (${at})`);
  };
  win.webContents.on('console-message', listen);
  let crashed = null;
  win.webContents.on('render-process-gone', (_e, details) => { crashed = details; });

  for (const name of String(list).split(',').map((s) => s.trim()).filter(Boolean)) {
    const sim = new Sim(win, { out, scenario: name });
    said = [];
    try {
      await sim.ready();
      await require(`./scenarios/${name}`)(sim);
    } catch (e) {
      sim.check('the scenario ran to its end', false, (e && e.stack) || e);
      // what was on screen when it stopped: the words of an error rarely say where it was
      try { await sim.shot('stopped-here'); } catch { /* the window is gone too */ }
    }
    // a picture that failed to download is the network's doing, and the catalog is live
    const errors = said.filter((m) => !/^Failed to load resource/.test(m));
    sim.check('the page reported no errors', !errors.length, errors.slice(0, 5).join(' | '), { errors, network: said.length - errors.length });
    sim.check('the page did not crash', !crashed, JSON.stringify(crashed));
    all.checks.push(...sim.checks);
    all.pictures.push(...sim.pictures);
  }
  const result = {
    at: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    machine: await machine(),
    passed: all.checks.every((c) => c.ok),
    ...all,
  };
  win.webContents.off('console-message', listen);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 1));
  return result;
}

/**
 * What src/dev-harness.ts starts when MM_SIM is set: once the page has loaded and settled, the
 * scenarios it names, then quit. The results go to MM_SIM_OUT (e2e-output/sim by default).
 * @param {import('electron').BrowserWindow} win
 */
function attach(win) {
  win.webContents.once('did-finish-load', () => setTimeout(() => {
    win.show();
    run(win, process.env.MM_SIM || '', { out: process.env.MM_SIM_OUT || 'e2e-output/sim' })
      .catch((e) => process.stdout.write(`sim failed: ${(e && e.stack) || e}\n`))
      .finally(() => app.quit());
  }, 4000));
}

module.exports = { Sim, run, attach, lit };
