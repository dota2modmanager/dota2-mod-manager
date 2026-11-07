import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelAttachment } from '../vendor/dota-loadout/src/skin-joints.js';

const rows = {
  hero: { attach_head_fx: { bone: 'hero-head' }, attach_tip: { bone: 'hero' } },
  'part-0': { attach_tip: { bone: 'weapon' } },
  'part-1': { attach_skirt_fx: { bone: 'arcana-skirt' } },
};
test('self binds to the equipped model instead of the hero fallback', () => {
  assert.equal(resolveModelAttachment(rows, 'attach_tip', 'part-0').bone, 'weapon');
});
test('self_with_wearables finds an attachment on another part of the arcana', () => {
  assert.equal(resolveModelAttachment(rows, 'ATTACH_SKIRT_FX', 'part-0', 'self_with_wearables').bone, 'arcana-skirt');
});
test('parent never accidentally binds to an identically named wearable attachment', () => {
  assert.equal(resolveModelAttachment(rows, 'attach_tip', 'part-0', 'parent').bone, 'hero');
});
