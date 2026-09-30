/* The catalog index presets are measured against (src/presets-service.ts catalogIndex).
 *
 * Listing, sharing and applying a preset all ask it cat.lookup(category, name, style). The method
 * used to be attached as the last step, after the catalog loaded, so a catalog that could not be
 * loaded at all (a first start with no network and nothing cached) returned a map without it, and
 * each of those calls threw. Found by the type checker, not by a report: rare, and total when hit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { presetsService } from '../src/presets-service.ts';

/** presetsService with a catalog that answers `load`; nothing else it is handed is asked. */
function serviceWith(load: () => Promise<unknown>) {
  return presetsService({ catalog: { load }, installer: {}, library: {}, schemaService: {}, deployAndApply: () => [] } as unknown as Parameters<typeof presetsService>[0]);
}

test('with no catalog to load, the index still answers lookups, with nothing', async () => {
  const svc = serviceWith(async () => { throw new Error('offline, nothing cached'); });
  const cat = await svc.catalogIndex();
  assert.equal(typeof cat.lookup, 'function');
  assert.equal(cat.lookup('heroes', 'Alien Nyx Assassin', null), null);
  assert.equal(cat.size, 0);
});

test('with a catalog, a mod is found by category, name and style', async () => {
  const svc = serviceWith(async () => ({
    mods: {
      modsData: {
        heroes: [
          { name: 'Alien Nyx Assassin', file: 'nyx.zip', preview: 'nyx.webp' },
          { name: 'Arcana Pack', styles: [{ label: 'Red', file: 'red.zip' }, { label: 'Blue', file: 'blue.zip' }] },
        ],
      },
    },
  }));
  const cat = await svc.catalogIndex();
  assert.equal(cat.lookup('heroes', 'Alien Nyx Assassin', null)?.fileRef, 'nyx.zip');
  assert.equal(cat.lookup('heroes', 'Arcana Pack', 'Blue')?.fileRef, 'blue.zip');
  assert.equal(cat.lookup('heroes', 'Arcana Pack', null), null, 'a styled mod is found by its style');
  assert.equal(cat.lookup('trees', 'Alien Nyx Assassin', null), null, 'and in its own category only');
});
