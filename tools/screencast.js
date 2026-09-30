/**
 * Screencast rig: drives the real app and films the result.
 *
 * The site needs a clip of the app working, and it will need a new one every time the app
 * changes, which is the whole reason this is a script rather than a screen recording somebody
 * makes by hand. A scene is a list of steps; running it produces a webm.
 *
 * Three things this had to solve.
 *
 * The pointer has to be visible and it has to be real. Neither `capturePage` nor a window
 * capture draws the mouse, and half of this interface only exists under it: cards lift, a plus
 * slides out, a heart takes the corner. So the pointer is driven with `sendInputEvent`, which
 * is a genuine input event and therefore does light up `:hover` and every handler the app has,
 * and a drawn arrow is injected into the page to follow it. The arrow follows by listening for
 * the very events the rig sends, so the two can never drift apart.
 *
 * Coordinates come in two units. `sendInputEvent` wants window pixels; a selector's box is in
 * CSS pixels, and the app scales itself. The ratio is measured once from the window against
 * `innerWidth` rather than assumed, because the user's own scale setting is seeded into the
 * sandbox and is not always 1.
 *
 * The file has to be encoded by something, and there is no ffmpeg here. MediaRecorder is the
 * encoder, so the recording happens in a second, hidden window that captures the first one and
 * writes the bytes itself.
 *
 * Dev-only. src/dev-harness.ts loads this only when MM_REC is set.
 */
const { BrowserWindow } = require('electron');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ease-in-out; a pointer that starts and stops abruptly reads as a machine, which it is */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// The arrow, and the ring that blooms where a click lands. Injected rather than shipped: this
// is the only piece that has to live inside the app's own page.
const PRESENTER = `(() => {
  if (window.__cast) return 'already';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M5 2.2 L19 11 L12.6 12.2 L15.8 18.6 L13 20 L9.8 13.6 L5 17.8 Z');
  p.setAttribute('fill', '#ffffff');
  p.setAttribute('stroke', '#101014');
  p.setAttribute('stroke-width', '1.3');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);

  const arrow = document.createElement('div');
  arrow.appendChild(svg);
  arrow.style.position = 'fixed';
  arrow.style.left = '0';
  arrow.style.top = '0';
  arrow.style.zIndex = '2147483647';
  arrow.style.pointerEvents = 'none';
  arrow.style.willChange = 'transform';
  arrow.style.filter = 'drop-shadow(0 2px 5px rgba(0,0,0,.55))';
  arrow.style.transform = 'translate3d(-200px,-200px,0)';
  document.body.appendChild(arrow);

  const ring = document.createElement('div');
  ring.style.position = 'fixed';
  ring.style.left = '0';
  ring.style.top = '0';
  ring.style.width = '46px';
  ring.style.height = '46px';
  ring.style.margin = '-23px 0 0 -23px';
  ring.style.borderRadius = '50%';
  ring.style.border = '2px solid rgba(208,188,255,.95)';
  ring.style.zIndex = '2147483646';
  ring.style.pointerEvents = 'none';
  ring.style.opacity = '0';
  ring.style.willChange = 'transform, opacity';
  document.body.appendChild(ring);

  let x = -200, y = -200;
  addEventListener('mousemove', (e) => {
    x = e.clientX; y = e.clientY;
    arrow.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
  }, { capture: true, passive: true });

  window.__cast = {
    ripple() {
      ring.style.transition = 'none';
      ring.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(.35)';
      ring.style.opacity = '.9';
      requestAnimationFrame(() => {
        ring.style.transition = 'transform 520ms cubic-bezier(.2,0,0,1), opacity 520ms ease-out';
        ring.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(1)';
        ring.style.opacity = '0';
      });
    },
    at() { return { x, y }; },
  };
  return 'ok';
})()`;

class Cast {
  constructor(win, opts = {}) {
    this.win = win;
    this.out = opts.out || process.cwd();
    // Landing-sized by default: the page shows this about 880px wide, and interface footage
    // is mostly still, so the frame is captured at 0.8 and the bitrate kept low. A clip that
    // blows the page's budget is a clip nobody waits for. MM_REC_W / MM_REC_BITRATE override
    // it for a take meant for somewhere with more room, like a release page.
    this.capW = Number(process.env.MM_REC_W || 1088);
    this.capH = Number(process.env.MM_REC_H || 688);
    this.bitrate = Number(process.env.MM_REC_BITRATE || opts.bitrate || 1_400_000);
    this.scale = 1;
    this.x = 40;
    this.y = 40;
    this.rec = null;
  }

  async setup() {
    await this.win.webContents.executeJavaScript(PRESENTER);
    // window pixels per CSS pixel, measured rather than assumed
    const [cw] = this.win.getContentSize();
    const inner = await this.win.webContents.executeJavaScript('window.innerWidth');
    this.scale = cw / inner;

    this.rec = new BrowserWindow({
      width: 320, height: 200, show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
    });
    this.rec.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
    await this.rec.loadFile(path.join(__dirname, 'screencast-recorder.html'));

    // Whether the app can install at all. A take where every install refuses is a take that
    // looks like a broken product, and the reason is never visible in the frame until the
    // toasts pile up; asking once, before the camera rolls, is cheaper than watching it back.
    //
    // Asking twice, in two different ways, because the first take was ruined by the gap
    // between them. On a userData folder with no settings yet - which is what a reset leaves,
    // and what a new user has - the catalog paints before the settings arrive, so the screen
    // keeps a cached "no game here": the banner stays up and every install refuses, while a
    // fresh IPC call cheerfully reports a valid path. One reload with the settings already on
    // disk clears it. Worth a fix of its own: the same race is a first-run bug.
    const ask = () => this.win.webContents.executeJavaScript(`(async () => {
      const s = await window.api.settings.get();
      return {
        pathValid: !!s.dotaPathValid,
        game: s.dotaGamePath || null,
        lang: s.uiLang,
        screenSaysNoGame: !!document.querySelector('#findDotaBtn'),
      };
    })()`);

    let ready = await ask();
    if (ready.pathValid && ready.screenSaysNoGame) {
      this.win.webContents.reload();
      await new Promise((r) => this.win.webContents.once('did-finish-load', r));
      await sleep(9000);
      await this.win.webContents.executeJavaScript(PRESENTER);
      ready = await ask();
      ready.reloaded = true;
    }
    return { scale: this.scale, inner, ...ready };
  }

  // ---- pointer ---------------------------------------------------------------------------

  /**
   * Where a selector is, in window pixels, or null if it is not on screen.
   *
   * "sel@3" means the third match. The grid puts its cards inside per-hero groups, so
   * `:nth-of-type` counts within a group and lands somewhere nobody asked for.
   */
  async find(spec) {
    const at = /@(\d+)$/.exec(spec);
    const sel = at ? spec.slice(0, -at[0].length) : spec;
    const nth = at ? Number(at[1]) - 1 : 0;
    const box = await this.win.webContents.executeJavaScript(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(sel)})[${nth}];
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return null;
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    })()`);
    if (!box) return null;
    return { x: Math.round(box.x * this.scale), y: Math.round(box.y * this.scale) };
  }

  async moveTo(x, y, dur = 620) {
    const x0 = this.x;
    const y0 = this.y;
    const frames = Math.max(2, Math.round(dur / 16));
    for (let i = 1; i <= frames; i++) {
      const k = ease(i / frames);
      const nx = Math.round(x0 + (x - x0) * k);
      const ny = Math.round(y0 + (y - y0) * k);
      this.win.webContents.sendInputEvent({ type: 'mouseMove', x: nx, y: ny });
      await sleep(16);
    }
    this.x = x;
    this.y = y;
  }

  async click() {
    await this.win.webContents.executeJavaScript('window.__cast && window.__cast.ripple()');
    this.win.webContents.sendInputEvent({ type: 'mouseDown', x: this.x, y: this.y, button: 'left', clickCount: 1 });
    await sleep(70);
    this.win.webContents.sendInputEvent({ type: 'mouseUp', x: this.x, y: this.y, button: 'left', clickCount: 1 });
  }

  async wheel(dy, steps = 6, gap = 55) {
    for (let i = 0; i < steps; i++) {
      this.win.webContents.sendInputEvent({
        type: 'mouseWheel', x: this.x, y: this.y,
        deltaX: 0, deltaY: dy, canScroll: true,
      });
      await sleep(gap);
    }
  }

  async typeText(text, gap = 85) {
    for (const ch of text) {
      this.win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await sleep(gap);
    }
  }

  // ---- steps -----------------------------------------------------------------------------

  async step(s, log) {
    if (s.wait) { await sleep(s.wait); return; }

    if (s.eval) { await this.win.webContents.executeJavaScript(s.eval); await sleep(s.after ?? 200); return; }

    if (s.wheel !== undefined) { await this.wheel(s.wheel, s.steps ?? 6, s.gap ?? 55); await sleep(s.after ?? 420); return; }

    if (s.type !== undefined) { await this.typeText(s.type, s.gap ?? 85); await sleep(s.after ?? 700); return; }

    const target = s.move || s.click || s.hover;
    if (!target) return;

    let point;
    if (Array.isArray(target)) point = { x: Math.round(target[0] * this.scale), y: Math.round(target[1] * this.scale) };
    else {
      point = await this.find(target);
      if (!point) { log(`  MISS ${target}`); return; }
    }

    await this.moveTo(point.x, point.y, s.dur ?? 620);
    if (s.hover) await sleep(s.hold ?? 900);
    if (s.click) {
      await sleep(s.settle ?? 180);
      // Aim again before pressing. Arriving at a card is what makes its controls appear, and
      // on this one the heart takes the corner while the plus slides 36px aside - so the
      // coordinates measured on the way there are the old ones, and the first take filmed a
      // pointer favouriting mods it meant to queue.
      if (!Array.isArray(target)) {
        const again = await this.find(target);
        if (again && Math.hypot(again.x - this.x, again.y - this.y) > 5) {
          await this.moveTo(again.x, again.y, 190);
          await sleep(90);
        }
      }
      await this.click();
      await sleep(s.after ?? 700);
    }
    else if (s.move) await sleep(s.after ?? 250);
  }

  // ---- scenes ----------------------------------------------------------------------------

  async scene(name, steps, log) {
    const file = path.join(this.out, `${name}.webm`);
    await this.rec.webContents.executeJavaScript(
      `window.startRec(${JSON.stringify(this.win.getMediaSourceId())}, ${this.capW}, ${this.capH}, ${this.bitrate})`);
    await sleep(500);                       // let the first frames settle before anything moves

    for (const s of steps) await this.step(s, log);

    await sleep(600);                       // and a beat at the end, so the cut is not abrupt
    const res = await this.rec.webContents.executeJavaScript(`window.stopRec(${JSON.stringify(file)})`);
    log(`scene ${name}: ${(res.bytes / 1e6).toFixed(2)} MB`);
    return file;
  }

  close() { if (this.rec && !this.rec.isDestroyed()) this.rec.destroy(); }
}

module.exports = { Cast, sleep };
