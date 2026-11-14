/* window.api under Tauri: preload.js itself, run against a stand-in for Electron's renderer half.
 *
 * Rust puts this file and preload.js together into the page's initialization script
 * (src-tauri/src/lib.rs), so the window gets the very same api object it gets in Electron and
 * nothing under renderer/ changes. ipcRenderer.invoke becomes one Tauri command, mm_invoke, which
 * Rust answers itself or hands to the TypeScript host; what the main process sends arrives as the
 * Tauri event "mm".
 *
 * Bytes travel as {$b64} both ways (src-tauri/host/wire.ts), and come out as Uint8Array here; an
 * answer that is only bytes arrives raw, as an ArrayBuffer (answerOf).
 */
(function () {
  if (window.__mmBridge) return;
  window.__mmBridge = true;

  // Electron points the window's catalog pictures at mm-preview://, which answers from disk and
  // from the mirror before GitHub (src/preview-cache.ts servePreviews). A webview has no request
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
     so the last drop's paths are kept by name for webUtils.getPathForFile. */
  const dropped = new Map();
  const pathOf = (file) => dropped.get(file && file.name) || '';

  const subscribers = new Map();
  const deliver = (channel, args) => {
    const list = subscribers.get(channel);
    if (!list) return;
    const decoded = decode(args || []);
    for (const cb of list) { try { cb({}, ...decoded); } catch (err) { console.error(err); } }
  };
  window.__mmDeliver = deliver;

  const listen = (event, handler) => {
    const cb = tauri().transformCallback((e) => handler(e.payload));
    return invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: cb });
  };
  const start = () => {
    const events = listen('mm', (p) => deliver(p.channel, p.args));
    listen('tauri://drag-drop', (p) => {
      dropped.clear();
      for (const full of (p && p.paths) || []) dropped.set(full.split(/[\\/]/).pop(), full);
    });
    /* "loaded" as Electron's did-finish-load means it: the page's scripts have run and subscribed,
       so what the shell says next (a d2mm:// link the app was started by, whether Dota is open)
       has someone to hear it. Told any earlier, it went nowhere. */
    const loaded = () => events.catch(() => {}).then(() => invoke('mm_loaded', {})).catch(() => {});
    if (document.readyState === 'complete') loaded(); else window.addEventListener('load', loaded, { once: true });
  };
  if (tauri()) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });

  // Ctrl +/-/0 scale the content, as Electron's before-input-event did (src/main-window.ts)
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || !['=', '+', '-', '_', '0'].includes(e.key)) return;
    e.preventDefault();
    invoke('mm_key', { key: e.key, control: true, alt: false }).catch(() => {});
  }, true);

  const ipcRenderer = {
    invoke: (channel, ...args) => invoke('mm_invoke', { channel, args: encode(args) }).then(answerOf),
    send: (channel, ...args) => { invoke('mm_send', { channel, args: encode(args) }).catch(() => {}); },
    on: (channel, cb) => {
      if (!subscribers.has(channel)) subscribers.set(channel, new Set());
      subscribers.get(channel).add(cb);
      return ipcRenderer;
    },
    removeListener: (channel, cb) => { subscribers.get(channel)?.delete(cb); return ipcRenderer; },
    removeAllListeners: (channel) => { subscribers.delete(channel); return ipcRenderer; },
  };
  const electron = {
    ipcRenderer,
    contextBridge: { exposeInMainWorld: (key, value) => { window[key] = value; } },
    webUtils: { getPathForFile: pathOf },
  };
  window.__mmRequire = (name) => {
    if (name === 'electron') return electron;
    throw new Error(`preload under Tauri: no module ${name}`);
  };
})();
