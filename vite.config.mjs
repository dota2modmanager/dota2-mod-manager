/* The window's page, built by Vite into out/renderer.
 *
 * main.js loads out/renderer/index.html; nothing loads renderer/index.html directly any more
 * except this build. `npm run dev` serves the same page from Vite instead, so a change to a
 * style, a component or an animation shows in the open window without a restart.
 *
 * renderer/uninstall.html is not built here: the uninstall window loads it straight from
 * renderer/, classic scripts and all (src/uninstall-window.js).
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
 * while `npm run dev` serves the page, so the development server relaxes that one directive
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

export default defineConfig({
  root,
  base: './',
  publicDir: path.join(root, 'public'),
  plugins: [react(), devOnlyInlineScript()],
  build: {
    outDir: path.join(here, 'out', 'renderer'),
    emptyOutDir: true,
    // the page only ever runs in Electron's own Chromium
    target: 'esnext',
    modulePreload: { polyfill: false },
    rollupOptions: { input: path.join(root, 'index.html') },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  clearScreen: false,
});
