/* What a test cannot see: a name that is not there.
 *
 * On 2026-09-06 splitting registerIpc moved a call to `blocked('install')` into
 * src/ipc-mods.js and left the function it calls in src/ipc-game.js. Every test passed. The
 * contract test read the files as text and found every channel name in its place; the unit
 * tests never load a module that needs Electron. Two releases shipped in which pressing
 * Install threw on the handler's first line, and nobody could install a mod at all.
 *
 * `no-undef` is the rule that names that bug in under a second, so it runs in CI and in the
 * commit guard. The rest of this file is the minimum needed to make that rule true: which
 * globals each corner of the codebase really has, so a real mistake is not buried in noise
 * about `document` in the main process.
 *
 * The TypeScript modules are outside this file. The type check (tools/typecheck.mjs) refuses a
 * name that is not there, which is the same rule with the types behind it.
 *
 * Style is not linted here on purpose. This is a check for code that cannot run, not a
 * argument about semicolons - and a lint run that people learn to skim is worth nothing.
 */

const ES = {
  // the standard library, everywhere
  globalThis: 'readonly', console: 'readonly', queueMicrotask: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
  clearInterval: 'readonly', structuredClone: 'readonly', fetch: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly',
  TextDecoder: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
  Intl: 'readonly', Blob: 'readonly', Headers: 'readonly', Request: 'readonly',
  Response: 'readonly', FormData: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
  performance: 'readonly', crypto: 'readonly', atob: 'readonly', btoa: 'readonly',
};

const NODE = {
  ...ES,
  require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly',
  Buffer: 'readonly', __dirname: 'readonly', __filename: 'readonly', global: 'readonly',
  setImmediate: 'readonly', clearImmediate: 'readonly',
};

const BROWSER = {
  ...ES,
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  history: 'readonly', screen: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  getComputedStyle: 'readonly', matchMedia: 'readonly', getSelection: 'readonly',
  alert: 'readonly', confirm: 'readonly', prompt: 'readonly', open: 'readonly',
  Image: 'readonly', Audio: 'readonly', FileReader: 'readonly', DOMParser: 'readonly',
  MutationObserver: 'readonly', IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
  HTMLElement: 'readonly', Element: 'readonly', Node: 'readonly', NodeFilter: 'readonly',
  Text: 'readonly', Range: 'readonly', WebSocket: 'readonly', Notification: 'readonly',
  HTMLImageElement: 'readonly', HTMLVideoElement: 'readonly', HTMLInputElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  ClipboardItem: 'readonly', DataTransfer: 'readonly', DragEvent: 'readonly',
  KeyboardEvent: 'readonly', MouseEvent: 'readonly', PointerEvent: 'readonly',
  WheelEvent: 'readonly', TouchEvent: 'readonly', AudioContext: 'readonly',
  ResizeObserverEntry: 'readonly', devicePixelRatio: 'readonly', scrollTo: 'readonly',
};

/* The only rules that answer "will this line throw the first time somebody reaches it".
 * `args: none` because the ctx objects these modules take are documentation as much as
 * plumbing: a dependency listed and not yet used is not a defect. */
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-func-assign': 'error',
  'no-obj-calls': 'error',
  'no-unsafe-negation': 'error',
  'no-unreachable': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-cond-assign': 'error',
  'no-const-assign': 'error',
  'no-self-assign': 'error',
  'no-class-assign': 'error',
  'no-import-assign': 'error',
  'no-setter-return': 'error',
  'no-this-before-super': 'error',
  'getter-return': 'error',
  // used deliberately in tools/check-i18n.js, which disables it by name there
  'no-new-func': 'error',
};

module.exports = [
  {
    ignores: [
      'node_modules/**', 'dist/**', 'sandbox/**', 'site/**', 'coverage/**',
      '.claude/**', 'assets/**',
    ],
  },
  {
    // the main process, the preload bridge and everything they require
    files: ['main.js', 'preload.js', 'src/**/*.js', 'test/**/*.js', 'tools/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: NODE },
    rules,
  },
  {
    /* The mail worker runs in Cloudflare's runtime rather than in Node: a module, with fetch and
       friends, and none of Node's own globals. */
    files: ['tools/email-worker/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { fetch: 'readonly', Headers: 'readonly', Response: 'readonly', console: 'readonly' },
    },
    rules,
  },
  {
    // .mjs tools are modules, and they have top-level await
    files: ['tools/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: NODE },
    rules,
  },
  {
    // the window: browser globals, plus the bridge preload.js puts there
    files: ['renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      /* `L` and `tr` are the translation helpers, put on window by renderer/i18n.js so every
         screen can use them without importing anything; `api` is the bridge preload.js
         installs. All three are globals in fact, so they are globals here. */
      globals: { ...BROWSER, api: 'readonly', L: 'readonly', tr: 'readonly' },
    },
    rules,
  },
];
