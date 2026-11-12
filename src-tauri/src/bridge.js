/* window.api under Tauri: preload.js itself, run against a stand-in for Electron's renderer half.
 *
 * Rust puts this file and preload.js together into the page's initialization script
 * (src-tauri/src/lib.rs), so the window gets the very same api object it gets in Electron and
 * nothing under renderer/ changes. ipcRenderer.invoke becomes one Tauri command, mm_invoke, which
 * Rust answers itself or hands to the TypeScript host; what the main process sends arrives as the
 * Tauri event "mm".
 *
 * Bytes travel as {$b64} both ways (src-tauri/host/wire.ts), and come out as Uint8Array here.
 */
(function () {
  if (window.__mmBridge) return;
  window.__mmBridge = true;

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
    listen('mm', (p) => deliver(p.channel, p.args));
    listen('tauri://drag-drop', (p) => {
      dropped.clear();
      for (const full of (p && p.paths) || []) dropped.set(full.split(/[\\/]/).pop(), full);
    });
    invoke('mm_loaded', {}).catch(() => {});
  };
  if (tauri()) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });

  // Ctrl +/-/0 scale the content, as Electron's before-input-event did (src/main-window.ts)
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || !['=', '+', '-', '_', '0'].includes(e.key)) return;
    e.preventDefault();
    invoke('mm_key', { key: e.key, control: true, alt: false }).catch(() => {});
  }, true);

  const ipcRenderer = {
    invoke: (channel, ...args) => invoke('mm_invoke', { channel, args: encode(args) }).then(decode),
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
