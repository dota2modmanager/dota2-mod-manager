/* electron-builder's beforePack hook (package.json, build.beforePack).
 *
 * Whatever started the build, npm run dist, release.yml or a hand-typed npx electron-builder,
 * the page packed into the installer is built from the sources being packed, not whatever
 * out/renderer happened to hold. */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

exports.default = async function beforePack() {
  const { buildUi } = await import(pathToFileURL(path.join(__dirname, 'ui-build.mjs')).href);
  await buildUi({ quiet: false });
};
