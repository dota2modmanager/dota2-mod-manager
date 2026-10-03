/* Point the sandbox's settings at the sandbox game before a run, or refuse to start.
 * `npm run start:sandbox` runs it through `node tools/sandbox.js pin`.
 *
 * The app re-detects the game whenever the saved path stops being an install, and detection
 * finds the real one through Steam. On 2026-10-03 the sandbox settings still named a sandbox
 * inside a copy of the repository deleted days before; the app took the real game instead,
 * saved it, and rewrote the ownership note in the real language folder. A sandbox run has
 * exactly one right game folder, so it is written in before every start instead of trusted.
 */
const fs = require('fs');
const path = require('path');
const { validateGamePath } = require('../src/steam.ts');

/**
 * @param {string} userData the sandbox's --user-data-dir
 * @param {string} game the sandbox game folder (...\dota 2 beta\game)
 * @param {(line: string) => void} [log]
 * @returns {string|null} why the run must not start, or null once the path is pinned
 */
function pinGamePath(userData, game, log = () => {}) {
  if (!validateGamePath(game)) return `no sandbox game at ${game}, run: npm run sandbox:seed`;
  const file = path.join(userData, 'settings.json');
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return `no sandbox settings at ${file}, run: npm run sandbox:seed`;
  }
  if (settings.dotaGamePath !== game) {
    log(`sandbox settings named ${settings.dotaGamePath || 'no game'}; pinned to ${game}`);
    settings.dotaGamePath = game;
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  return null;
}

module.exports = { pinGamePath };
