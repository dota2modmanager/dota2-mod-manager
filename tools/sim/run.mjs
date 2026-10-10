#!/usr/bin/env node
/**
 * Runs the app through scenarios on simulated machines and writes a report.
 *
 *   node tools/sim/run.mjs                              the "pr" set for this system, every scenario
 *   node tools/sim/run.mjs --set misha                  Misha's machine, every renderer
 *   node tools/sim/run.mjs --only fhd:angle-gl          one screen and renderer
 *   node tools/sim/run.mjs --scenario scroll            one scenario
 *   node tools/sim/run.mjs --app <exe>                  a packaged build instead of this tree
 *
 * One app launch per screen and renderer: the renderer is a command-line switch and the screen is
 * decided when the window opens, so neither can change mid-run. Each launch gets the sandbox's
 * user data (tools/sandbox.js), MM_SIM with the scenarios, MM_WORKAREA and a forced scale for
 * the screen, and the renderer's switches; on Linux the screen is a real xvfb screen of that
 * size. Each writes e2e-output/sim/<screen>--<renderer>/results.json, and this gathers them into
 * summary.json and index.html, the page to open when something went red.
 *
 * Every launch starts from a reset sandbox (node tools/sandbox.js reset: the game tree back to
 * pristine, the user data re-seeded, downloaded mods kept). A scenario installs and switches mods,
 * and until 2026-10-01 the next launch started among whatever the last one left: a second screen
 * in the same run, or the next run on the same machine, failed on a library it never made.
 * The state after the last launch is left as it is, to look at.
 *
 * Exit code 1 when any check failed, 2 when a launch produced no results at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ensureUi } from '../ui-build.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const OUT = path.join(root, 'e2e-output', 'sim');
const USERDATA = path.join(root, 'sandbox', 'userdata');
const config = JSON.parse(fs.readFileSync(path.join(here, 'profiles.json'), 'utf8'));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** The screen and renderer pairs to run, from --only or a named set for this system. */
export function plan({ only, set = 'pr', platform = process.platform } = {}) {
  if (only) return only.split(',').map((p) => p.split(':')).map(([s, r = 'default']) => [s, r]);
  const chosen = config.sets[set];
  if (!chosen) throw new Error(`no set "${set}"; there are ${Object.keys(config.sets).join(', ')}`);
  return chosen[platform === 'win32' ? 'win32' : 'linux'] || [];
}

/**
 * Which scenarios the i-th machine of a set runs. The first gets all of them; the rest get the
 * ones whose outcome depends on the screen and the renderer (config.looks). What installing a
 * mod or applying a preset does to the game folder is the same on every screen, and running
 * those on all thirteen machines put the nightly set past its hour. A scenario named on the
 * command line runs everywhere, as asked.
 */
export function scenariosFor(i, all, { looks = config.looks, explicit = false } = {}) {
  if (explicit || i === 0) return all;
  return all.split(',').filter((s) => looks.includes(s)).join(',') || all;
}

/** The command line and environment one launch needs. Pure, so the tests can read it. */
export function launch(screenName, rendererName, { scenarios, app = null, platform = process.platform, electron = 'electron' } = {}) {
  const screen = config.screens[screenName];
  const renderer = config.renderers[rendererName];
  if (!screen) throw new Error(`no screen "${screenName}"`);
  if (!renderer) throw new Error(`no renderer "${rendererName}"`);
  const out = path.join(OUT, `${screenName}--${rendererName}`);
  // held to the sandbox: a write anywhere else is refused (src/write-jail.ts)
  const args = [...(app ? [] : [root]), `--user-data-dir=${USERDATA}`, `--write-jail=${path.dirname(USERDATA)}`, ...renderer.args];
  if (screen.scale && screen.scale !== 1 && platform === 'win32') args.push(`--force-device-scale-factor=${screen.scale}`);
  const env = { ...process.env, MM_SIM: scenarios, MM_SIM_OUT: out };
  if (screen.workArea && platform === 'win32') env.MM_WORKAREA = screen.workArea;
  let cmd = app || electron;
  let cmdArgs = args;
  if (platform === 'linux') {
    // Chromium's sandbox wants kernel permissions a CI runner does not grant (linux.yml says the same)
    args.push('--no-sandbox');
    if (screen.screen) {
      // a real screen of that size; the scale is left to the page, xvfb has no DPI setting worth trusting
      cmdArgs = ['-a', '-s', `-screen 0 ${screen.screen}x24`, cmd, ...args];
      cmd = 'xvfb-run';
    }
  }
  return { cmd, args: cmdArgs, env, out };
}

function scenarioList() {
  const only = arg('scenario');
  if (only) return only;
  return fs.readdirSync(path.join(here, 'scenarios')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).join(',');
}

function runOne(spec, timeoutMs) {
  return new Promise((resolve) => {
    fs.rmSync(spec.out, { recursive: true, force: true });
    const child = spawn(spec.cmd, spec.args, { env: spec.env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { log += d; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('exit', () => {
      clearTimeout(timer);
      fs.mkdirSync(spec.out, { recursive: true });
      fs.writeFileSync(path.join(spec.out, 'app-output.txt'), log);
      const file = path.join(spec.out, 'results.json');
      resolve(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
    });
  });
}

/**
 * What one launch got wrong besides its failed checks: a scenario it was asked for that wrote no
 * check at all, or a launch with no checks. A scenario that stops being run (a renamed step, an
 * exception swallowed before the first check) used to leave the run green with fewer checks in it.
 */
export function silentScenarios(asked, checks) {
  const wrote = new Set((checks || []).map((c) => c.scenario));
  const names = String(asked || '').split(',').map((s) => s.trim()).filter(Boolean);
  const silent = names.filter((n) => !wrote.has(n)).map((n) => `${n}: wrote no check at all`);
  if (!(checks || []).length) silent.push('the launch wrote no checks');
  return silent;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** One page with every run, every failed check and its pictures. */
export function reportHtml(runs) {
  const rows = runs.map((r) => {
    const failed = r.result ? r.result.checks.filter((c) => !c.ok) : [];
    const status = !r.result ? 'no results' : failed.length ? `${failed.length} failed` : 'all passed';
    const gpu = r.result?.machine?.gpuDevices?.find((d) => d.active) || r.result?.machine?.gpuDevices?.[0];
    const pics = (r.result?.pictures || []).map((p) => `<a href="${esc(r.dir)}/${esc(p)}"><img src="${esc(r.dir)}/${esc(p)}" alt="${esc(p)}"></a>`).join('');
    return `<section class="${failed.length || !r.result ? 'bad' : 'good'}"><h2>${esc(r.dir)} <small>${esc(status)}</small></h2>
<p>${esc(config.screens[r.screen]?.what || '')} &middot; ${esc(config.renderers[r.renderer]?.what || '')}${gpu ? ` &middot; GPU ${esc(gpu.vendorId)}:${esc(gpu.deviceId)} driver ${esc(gpu.driverVersion || '')}` : ''}</p>
${failed.length ? `<ul>${failed.map((c) => `<li><b>${esc(c.scenario)}</b>: ${esc(c.name)}<br><code>${esc(c.detail)}</code></li>`).join('')}</ul>` : ''}
<div class="pics">${pics}</div></section>`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Simulation report</title>
<style>body{font:14px system-ui;background:#141218;color:#e6e0e9;margin:24px}section{border:1px solid #49454f;border-radius:12px;padding:12px 16px;margin:0 0 16px}
.bad{border-color:#f2b8b5}.good h2 small{color:#a6d5a0}.bad h2 small{color:#f2b8b5}code{white-space:pre-wrap;color:#cac4d0}.pics{display:flex;flex-wrap:wrap;gap:8px}.pics img{width:240px;border-radius:6px}</style>
<h1>Simulation report</h1><p>${runs.length} run(s), ${new Date().toISOString()}</p>${rows}`;
}

async function main() {
  if (!fs.existsSync(path.join(USERDATA, 'settings.json'))) {
    console.error('The sandbox is not seeded. Run npm run sandbox:seed first.');
    process.exit(2);
  }
  // a checkout runs the page Vite built: a stale one would simulate yesterday's interface
  if (!arg('app')) await ensureUi();
  const pairs = plan({ only: arg('only'), set: arg('set', 'pr') });
  const all = scenarioList();
  const explicit = Boolean(arg('scenario'));
  const electron = require('electron');
  const runs = [];
  for (const [i, [screen, renderer]] of pairs.entries()) {
    execFileSync(process.execPath, [path.join(root, 'tools', 'sandbox.js'), 'reset'], { cwd: root, stdio: 'ignore' });
    const scenarios = scenariosFor(i, all, { explicit });
    const spec = launch(screen, renderer, { scenarios, app: arg('app'), electron });
    console.log(`\n=== ${screen} / ${renderer}: ${scenarios}`);
    const result = await runOne(spec, Number(arg('timeout', 900)) * 1000);
    runs.push({ screen, renderer, dir: path.basename(spec.out), result, silent: result ? silentScenarios(scenarios, result.checks) : [] });
  }
  fs.mkdirSync(OUT, { recursive: true });
  const summary = runs.map((r) => ({ screen: r.screen, renderer: r.renderer, passed: (r.result?.passed ?? false) && !r.silent.length,
    failed: r.result ? [...r.result.checks.filter((c) => !c.ok).map((c) => `${c.scenario}: ${c.name}: ${c.detail}`), ...r.silent] : ['no results'] }));
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(OUT, 'index.html'), reportHtml(runs));
  const bad = summary.filter((s) => !s.passed);
  console.log(`\n${summary.length - bad.length} of ${summary.length} run(s) passed. Report: ${path.join(OUT, 'index.html')}`);
  process.exit(runs.some((r) => !r.result) ? 2 : bad.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
