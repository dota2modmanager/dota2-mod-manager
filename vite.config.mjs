/* The window's page, built by Vite into out/renderer-tauri, which the Tauri shell embeds
 * (src-tauri/tauri.conf.json frontendDist). Build it with tools/dev/ui-build.mjs.
 *
 * renderer/uninstall.html is not built here: tools/dev/ui-build.mjs copies it beside the page,
 * classic scripts and all.
 *
 * renderer/public/ is copied as it is. It holds what code names by a path built at run time
 * (./assets/effects/<id>.webp), which the bundler cannot follow and so would not copy.
 */
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = import.meta.dirname;
const root = path.join(here, 'renderer');

/* The page's CSP allows no inline script. React's refresh preamble is one, and it only exists
 * while Vite serves the page (npx vite), so the development server relaxes that one directive
 * and the built page keeps the policy exactly as index.html spells it. */
function devOnlyInlineScript() {
  return {
    name: 'mm-dev-inline-script',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    },
  };
}

/* The shell's IPC is a fetch to ipc.localhost, which the page's connect-src has to name. */
function tauriPolicy() {
  return {
    name: 'mm-tauri-policy',
    transformIndexHtml(html) {
      return html.replace("connect-src 'self'", "connect-src 'self' ipc: http://ipc.localhost");
    },
  };
}

export default defineConfig({
  root,
  base: './',
  publicDir: path.join(root, 'public'),
  plugins: [react(), devOnlyInlineScript(), tauriPolicy()],
  build: {
    outDir: path.join(here, 'out', 'renderer-tauri'),
    emptyOutDir: true,
    // the page only ever runs in WebView2 or WebKitGTK, both current
    target: 'esnext',
    modulePreload: { polyfill: false },
    // the licences of every package compiled into the page, written beside it and shipped with it
    // (NOTICE points here): the bundle itself keeps none of their headers
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
    rollupOptions: { input: path.join(root, 'index.html') },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  clearScreen: false,
});
