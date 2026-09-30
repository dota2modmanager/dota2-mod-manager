/* The support report, read out of the zip it writes (src/ipc-diagnostics.ts).
 *
 * Twice a section of this report was gathered and never arrived. The displays and the graphics
 * card were collected and then dropped by the step that copied them into the report, and the
 * toolchain section asked for a function the toolchain never had, so every report sent carried
 * "toolchain.installed is not a function" where the answer should have been. Both were checked
 * by reading the code that gathered them. This test opens the file that comes out instead.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { registerDiagnosticsIpc } from '../src/ipc-diagnostics.ts';
import { Settings } from '../src/settings.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const TOOLCHAIN = [{ name: 'vpk', version: '1.0', latest: '1.0' }];

function stand(t: TestContext, { cancel = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-ipc-diag-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'report.zip');
  const userData = path.join(dir, 'userdata');
  const library = new Library(userData);
  library.add({ name: 'Pudge Hook', categoryId: 'heroes', files: [] });
  const installer = new Installer({ userDataDir: userData, getGamePath: () => null, getLangSuffix: () => 'russian', onProgress: () => {} });
  const shown: string[] = [];

  const channels = registerAgainst(() => registerDiagnosticsIpc({
    autoUpdater: null,
    catalog: { cacheInfo: () => ({ fetchedAt: null }) },
    diag: () => {},
    dotaIsRunning: async () => false,
    icons: { size: () => 0 },
    installer,
    library,
    logFile: () => path.join(dir, 'main.log'),
    remoteConfig: { url: 'https://example.invalid/config.json', SWITCHABLE: ['install'], feature: () => true, notices: () => [] },
    schemaService: { state: () => ({ enabled: false, patched: true, deployed: false, stale: false, mods: 0 }) },
    settings: new Settings(userData),
    toolchain: { state: () => TOOLCHAIN },
    win: () => ({}),
    rendererErrors: () => [{ message: 'a renderer error' }],
    lastUpdateError: () => null,
  } as never), {
    app: {
      getVersion: () => '9.9.9', getPath: () => userData,
      getGPUInfo: async () => ({ gpuDevice: [{ active: true, vendorId: 4318, deviceId: 7, driverVendor: 'NVIDIA', driverVersion: '1', extra: 'dropped' }] }),
      getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled' }),
    },
    BrowserWindow: { getAllWindows: () => [] },
    screen: {
      getAllDisplays: () => [{ id: 1, size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.5 }],
      getPrimaryDisplay: () => ({ id: 1 }),
    },
    dialog: { showSaveDialog: async () => (cancel ? { canceled: true } : { canceled: false, filePath: out }) },
    shell: { showItemInFolder: (p: string) => shown.push(p) },
  });
  const exportReport = () => channels.get('diag:export')!({});
  return { exportReport, out, shown };
}

test('the zip holds the summary, the full report and the raw data, and is shown in its folder', async (t) => {
  const s = stand(t);
  const r = await s.exportReport();
  assert.deepEqual(r, { ok: true, path: s.out });
  assert.deepEqual(s.shown, [s.out]);

  const names = new AdmZip(s.out).getEntries().map((e) => e.entryName);
  for (const want of ['SUMMARY.txt', 'REPORT.md', 'report.json', 'manifest.json']) {
    assert.ok(names.includes(want), `${want} is in the zip`);
  }
});

test('what the main process gathered arrives in the report, not only in the code that gathered it', async (t) => {
  const s = stand(t);
  await s.exportReport();
  const report = JSON.parse(new AdmZip(s.out).readAsText('report.json'));

  assert.deepEqual(report.toolchain, TOOLCHAIN, 'the toolchain as it is on disk, not an error about a missing function');
  assert.deepEqual(report.gpu.devices, [{ active: true, vendorId: 4318, deviceId: 7, driverVendor: 'NVIDIA', driverVersion: '1' }]);
  assert.equal(report.displays[0].scaleFactor, 1.5);
  assert.equal(report.displays[0].primary, true);
  assert.deepEqual(report.remoteConfig.switches, { install: true });
  assert.deepEqual(report.rendererErrors, [{ message: 'a renderer error' }]);
  assert.equal(report.app.version, '9.9.9');
  assert.equal(report.installedMods[0].name, 'Pudge Hook');
});

test('closing the save dialog writes nothing', async (t) => {
  const s = stand(t, { cancel: true });
  assert.deepEqual(await s.exportReport(), { cancelled: true });
  assert.equal(fs.existsSync(s.out), false);
});
