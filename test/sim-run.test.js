/* How tools/sim/run.mjs turns a screen and a renderer into one launch of the app.
 *
 * A profile that quietly launches with the wrong switches is a machine nobody simulated, and the
 * report says it passed. These pin what each launch is handed: the renderer's Chromium switches,
 * the forced scale and the stand-in work area on Windows, a real xvfb screen on Linux, and the
 * sets that decide what runs where.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const load = () => import('../tools/sim/run.mjs');
const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'sim', 'profiles.json'), 'utf8'));

test('a Windows launch gets the renderer switches, the forced scale and the work area', async () => {
  const { launch } = await load();
  const l = launch('laptop-125', 'angle-gl', { scenarios: 'scroll', platform: 'win32', electron: 'electron.exe' });
  assert.equal(l.cmd, 'electron.exe');
  assert.ok(l.args.includes('--use-angle=gl'));
  assert.ok(l.args.includes('--force-device-scale-factor=1.25'));
  assert.equal(l.env.MM_WORKAREA, '1093x582');
  assert.equal(l.env.MM_SIM, 'scroll');
  assert.match(l.out, /laptop-125--angle-gl$/);
});

test('a Linux launch gets a real screen of that size from xvfb instead of a stand-in', async () => {
  const { launch } = await load();
  const l = launch('laptop', 'default', { scenarios: 'scroll', platform: 'linux', electron: '/usr/bin/electron' });
  assert.equal(l.cmd, 'xvfb-run');
  assert.deepEqual(l.args.slice(0, 4), ['-a', '-s', '-screen 0 1366x768x24', '/usr/bin/electron']);
  assert.equal(l.env.MM_WORKAREA, undefined);
  assert.ok(l.args.includes('--no-sandbox'), 'a CI runner will not grant Chromium its sandbox');
});

test('a packaged build is launched as itself, without the source tree', async () => {
  const { launch } = await load();
  const l = launch('fhd', 'default', { scenarios: 'scroll', platform: 'win32', app: 'C:/app/Dota 2 Mod Manager.exe' });
  assert.equal(l.cmd, 'C:/app/Dota 2 Mod Manager.exe');
  assert.ok(l.args[0].startsWith('--user-data-dir='), 'no repository path in front of the switches');
});

test('an unknown screen or renderer is refused rather than run as something else', async () => {
  const { launch } = await load();
  assert.throws(() => launch('nope', 'default', { scenarios: 's' }), /no screen "nope"/);
  assert.throws(() => launch('fhd', 'nope', { scenarios: 's' }), /no renderer "nope"/);
});

test('every set names screens and renderers that exist, and the pull-request set stays small', async () => {
  const { plan } = await load();
  for (const [name, set] of Object.entries(profiles.sets)) {
    for (const platform of ['win32', 'linux']) {
      for (const [screen, renderer] of set[platform] || []) {
        assert.ok(profiles.screens[screen], `${name}/${platform}: no screen "${screen}"`);
        assert.ok(profiles.renderers[renderer], `${name}/${platform}: no renderer "${renderer}"`);
      }
    }
  }
  assert.ok(plan({ set: 'pr', platform: 'win32' }).length <= 2, 'every pull request waits for this set');
  assert.deepEqual(plan({ only: 'fhd:angle-gl,qhd' }), [['fhd', 'angle-gl'], ['qhd', 'default']]);
});

test('only the first machine of a set runs every scenario, the rest the ones a screen changes', async () => {
  const { scenariosFor } = await load();
  const all = 'browse,game-session,mods,presets,scroll,settings';
  assert.equal(scenariosFor(0, all), all);
  assert.equal(scenariosFor(3, all), 'browse,scroll,settings');
  // named on the command line: every machine runs it, even one the screen does not change
  assert.equal(scenariosFor(3, 'mods', { explicit: true }), 'mods');
  // a list with nothing the screen changes still runs rather than launching an empty window
  assert.equal(scenariosFor(2, 'mods,presets'), 'mods,presets');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'sim', 'profiles.json'), 'utf8'));
  for (const s of config.looks) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools', 'sim', 'scenarios', `${s}.js`)), `looks names ${s}, which is not a scenario`);
  }
});

test('the report names each failed check and escapes what the page shows', async () => {
  const { reportHtml } = await load();
  const html = reportHtml([{ screen: 'fhd', renderer: 'default', dir: 'fhd--default', result: {
    passed: false, pictures: ['scroll-top.png'], machine: { gpuDevices: [] },
    checks: [{ scenario: 'scroll', name: 'the <last> card', ok: false, detail: 'ends at 900' }],
  } }]);
  assert.match(html, /1 failed/);
  assert.match(html, /the &lt;last&gt; card/);
  assert.match(html, /fhd--default\/scroll-top\.png/);
});

test('a scenario that wrote no check fails the run, and so does a launch with none', async () => {
  const { silentScenarios } = await load();
  const checks = [{ scenario: 'scroll', name: 'x', ok: true }, { scenario: 'mods', name: 'y', ok: true }];
  assert.deepEqual(silentScenarios('scroll,mods', checks), []);
  assert.deepEqual(silentScenarios('scroll,mods,presets', checks), ['presets: wrote no check at all']);
  assert.deepEqual(silentScenarios('scroll', []), ['scroll: wrote no check at all', 'the launch wrote no checks']);
});
