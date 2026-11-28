/* The page's way to the app. Rust puts this file in front of api.js (or uninstall-api.js for the
 * removal window) in the page's initialization script (src-tauri/src/main.rs init_script), and
 * the two build window.api on what this one leaves at window.__mm:
 *
 *   invoke(channel, ...args)  one Tauri command, mm_invoke, that Rust answers; a Promise
 *   send(channel, ...args)    the same, when nothing waits for an answer
 *   on(channel, cb)           what the shell sends, the Tauri event "mm", by channel
 *   pathOf(file)              the full path of a file dropped on the window
 *   on('win:fileDrag', cb)    files dragged onto the window from outside, by their paths
 *
 * Bytes travel as {$b64} both ways and come out as Uint8Array here; an answer that is only bytes
 * arrives raw, as an ArrayBuffer (answerOf). The rest of this file is what a webview does not do
 * by itself: the catalog's pictures from disk, the title bar, Ctrl +/-/0.
 */
(function () {
  if (window.__mmBridge) return;
  window.__mmBridge = true;

  // The catalog's pictures come through mm-preview://, which answers from disk and from the mirror
  // before GitHub (crates/mm-core/src/catalog/preview_cache.rs). A webview has no request
  // redirect, so an image's address is changed as the page sets it; Rust answers the scheme
  // (Previews in src-tauri/src/ported.rs). WebView2 serves a custom scheme as http://<name>.localhost.
  const RAW = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/';
  const PICTURES = /Windows/.test(navigator.userAgent) ? 'http://mm-preview.localhost/' : 'mm-preview://catalog/';
  const local = (v) => (typeof v === 'string' && v.startsWith(`${RAW}assets/previews/`) ? PICTURES + v.slice(RAW.length) : v);
  const img = window.HTMLImageElement && Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (img && img.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...img, set(v) { img.set.call(this, local(v)); } });
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return setAttribute.call(this, name, this instanceof HTMLImageElement && String(name).toLowerCase() === 'src' ? local(value) : value);
    };
  }

  const toB64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (b64) => {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  const encode = (v) => {
    if (v === null || typeof v !== 'object') return v === undefined ? null : v;
    if (v instanceof ArrayBuffer) return { $b64: toB64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { $b64: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (Array.isArray(v)) return v.map(encode);
    if (typeof window.File !== 'undefined' && v instanceof window.File) return { name: v.name, path: pathOf(v) };
    const out = {};
    for (const k of Object.keys(v)) if (typeof v[k] !== 'function') out[k] = encode(v[k]);
    return out;
  };
  const decode = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decode);
    if (typeof v.$b64 === 'string' && Object.keys(v).length === 1) return fromB64(v.$b64);
    const out = {};
    for (const k of Object.keys(v)) out[k] = decode(v[k]);
    return out;
  };

  /* An invoke's answer (src-tauri/src/main.rs answer): bytes alone come raw, an answer with bytes
     deeper in comes as {$mmb}, and any other is used as it came, without a walk over it. */
  const answerOf = (v) => {
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (v && typeof v === 'object' && !Array.isArray(v) && '$mmb' in v && Object.keys(v).length === 1) return decode(v.$mmb);
    return v;
  };

  const tauri = () => window.__TAURI_INTERNALS__;
  const invoke = (cmd, args) => tauri().invoke(cmd, args);

  /* Files dropped on the window: Tauri reports their paths apart from the DOM's File objects,
     so the last drop's paths are kept by name for pathOf. */
  const dropped = new Map();
  const pathOf = (file) => dropped.get(file && file.name) || '';

  const subscribers = new Map();
  const deliver = (channel, args) => {
    const list = subscribers.get(channel);
    if (!list) return;
    const decoded = decode(args || []);
    for (const cb of list) { try { cb(...decoded); } catch (err) { console.error(err); } }
  };

  const listen = (event, handler) => {
    const cb = tauri().transformCallback((e) => handler(e.payload));
    return invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: cb });
  };
  const start = () => {
    const events = listen('mm', (p) => deliver(p.channel, p.args));
    /* Files dragged in from outside never reach the DOM: Tauri's own drop handler takes them, and
       wry switches WebView2's external drop off for it, so no dragenter or drop fires. The page
       hears Tauri's events instead, as win:fileDrag, with the files' full paths and where the
       cursor is in CSS pixels (renderer/shell/drop.ts). */
    const fileDrag = (type) => (p) => {
      const paths = (p && p.paths) || [];
      if (type === 'drop') {
        dropped.clear();
        for (const full of paths) dropped.set(full.split(/[\\/]/).pop(), full);
      }
      const scale = window.devicePixelRatio || 1;
      const at = (p && p.position) || { x: 0, y: 0 };
      deliver('win:fileDrag', [{ type, paths, x: at.x / scale, y: at.y / scale }]);
    };
    listen('tauri://drag-enter', fileDrag('enter'));
    listen('tauri://drag-leave', fileDrag('leave'));
    listen('tauri://drag-drop', fileDrag('drop'));
    /* "loaded" means the page's scripts have run and subscribed,
       so what the shell says next (a d2mm:// link the app was started by, whether Dota is open)
       has someone to hear it. Told any earlier, it went nowhere. */
    const loaded = () => events.catch(() => {}).then(() => invoke('mm_loaded', {})).catch(() => {});
    if (document.readyState === 'complete') loaded(); else window.addEventListener('load', loaded, { once: true });
  };
  if (tauri()) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });

  // The title bar moves the window. WebView2 honours -webkit-app-region: drag, but recomputes the
  // regions synchronously at every step of a resize, about 900 ms each (measured 2026-11-14), so
  // dragging an edge stalled and leaving a maximized window froze for seconds. Here the regions are
  // switched off, and a press where the CSS marks the bar draggable (--drag: 1 beside each app-region
  // rule) asks Rust to move the window, a second press in a row to maximize it, as a native caption
  // does.
  const noRegions = () => {
    const off = document.createElement('style');
    off.textContent = '*, *::before, *::after { -webkit-app-region: no-drag !important; }';
    document.head.append(off);
  };
  if (document.head) noRegions(); else document.addEventListener('DOMContentLoaded', noRegions, { once: true });
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    if (getComputedStyle(e.target).getPropertyValue('--drag').trim() !== '1') return;
    e.preventDefault();
    invoke('mm_drag', { toggle: e.detail === 2 }).catch(() => {});
  }, true);

  // Ctrl +/-/0 scale the content (crates/mm-core/src/app/main_window.rs)
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || !['=', '+', '-', '_', '0'].includes(e.key)) return;
    e.preventDefault();
    invoke('mm_key', { key: e.key, control: true, alt: false }).catch(() => {});
  }, true);

  window.__mm = {
    invoke: (channel, ...args) => invoke('mm_invoke', { channel, args: encode(args) }).then(answerOf),
    send: (channel, ...args) => { invoke('mm_send', { channel, args: encode(args) }).catch(() => {}); },
    on: (channel, cb) => {
      if (!subscribers.has(channel)) subscribers.set(channel, new Set());
      subscribers.get(channel).add(cb);
    },
    pathOf,
  };
})();
