#!/usr/bin/env node
/**
 * `npm run dev`: the app with the page served by Vite, so an edit to a style, a component or an
 * animation shows in the open window without a restart.
 *
 * Only an unpackaged run honours MM_DEV_URL (src/app-page.ts), and only for this machine. Arguments pass
 * through to Electron: `npm run dev -- --user-data-dir=sandbox/userdata` runs against the sandbox.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');

const server = await createServer({ configFile: path.join(root, 'vite.config.mjs') });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`vite serving the page at ${url}`);

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MM_DEV_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
