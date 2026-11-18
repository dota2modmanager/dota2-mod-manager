// The code every start of the app compiles is what renderer/app.ts reaches through static imports.
// The 3D view (three.js), the preset picture's QR code and the bloody night's drawings are asked
// for when they are used; one static import from a module on the start path pulls them back into
// it, which is how three.js was in it until DecorModal stopped importing map-trees.ts for a name.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'renderer');
const LATE = [/^three(\/|$)/, /^qrcode-generator$/];
const LATE_FILES = ['ui/blood.ts', 'views/presets/picture.ts', 'catalog/decor/map-trees.ts'];

/** Specifiers a module imports at load: `import type` and `import()` are left out. */
function staticImports(src) {
  const out = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (let m; (m = re.exec(src));) out.push(m[1]);
  return out;
}

test('three.js, the QR code and the bloody night are not on the path every start compiles', () => {
  const seen = new Set();
  const bad = [];
  const walk = (file, from) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = path.relative(RENDERER, file).replace(/\\/g, '/');
    if (LATE_FILES.includes(rel)) bad.push(`${rel} (from ${from})`);
    for (const spec of staticImports(fs.readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) {
        if (LATE.some((r) => r.test(spec))) bad.push(`${spec} (from ${rel})`);
        continue;
      }
      const next = path.resolve(path.dirname(file), spec);
      if (/\.(ts|tsx|js|mjs)$/.test(next) && fs.existsSync(next)) walk(next, rel);
    }
  };
  walk(path.join(RENDERER, 'app.ts'), 'index.html');
  assert.ok(seen.size > 50, `the walk reached only ${seen.size} modules`);
  assert.deepStrictEqual(bad, []);
});
