/* The catalog's naming rules (renderer/creator/naming.ts): what the upload page does to a mod's
 * name as it is typed, so the window and the API accept the same names. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanName, ensureHero, heroAsName, heroIn, nameFor, nameLimit, swapHero, titleCaseWords } from '../renderer/creator/naming.ts';

test('every word gets a first capital and the rest lowercase', () => {
  assert.equal(titleCaseWords('blue GLOW of the anti-mage'), 'Blue Glow Of The Anti-Mage');
  assert.equal(titleCaseWords("nature's prophet"), "Nature's Prophet");
});

test('only Latin letters, digits and single spaces stay, and the hero sets the room', () => {
  assert.equal(cleanName('  Blue   glow!!  '), 'Blue glow');
  assert.equal(cleanName('  Anti--Mage   Glow-  '), 'Anti-Mage Glow', 'a hyphen in a hero name stays');
  assert.equal(cleanName('Синий свет'), '');
  assert.equal(cleanName('a'.repeat(40)), 'a'.repeat(29));
  assert.equal(nameLimit('Anti-Mage'), 29);
  assert.equal(nameLimit("Nature's Prophet"), 39);
  assert.equal(nameLimit('Keeper of the Light'), 39);
});

test('the hero’s name is written in when it is missing, and kept when it is there', () => {
  assert.equal(heroAsName("Nature's Prophet"), 'Natures Prophet');
  assert.equal(heroAsName('Anti-Mage'), 'Anti-Mage');
  assert.equal(ensureHero('', 'Anti-Mage'), 'Anti-Mage');
  assert.equal(ensureHero('Blue Glow', 'Anti-Mage'), 'Anti-Mage Blue Glow');
  assert.equal(ensureHero('Anti-Mage Blue Glow', 'Anti-Mage'), 'Anti-Mage Blue Glow');
  assert.equal(ensureHero('Blue Glow', 'Keeper of the Light'), 'Keeper of the Light Blue Glow');
  assert.equal(ensureHero('Blue Glow', "Nature's Prophet"), 'Natures Prophet Blue Glow');
});

test('a picked hero replaces the one the name already has', () => {
  const heroes = ['Anti-Mage', 'Axe', "Nature's Prophet"];
  assert.equal(heroIn('Anti-Mage Blue Glow', heroes), 'Anti-Mage');
  assert.equal(swapHero('Anti-Mage Blue Glow', 'Axe', heroes), 'Axe Blue Glow');
  assert.equal(swapHero('Blue Glow', 'Axe', heroes), null);
  assert.equal(swapHero('Antimage Blue Glow', 'Axe', ['Anti-Mage']), 'Axe Blue Glow', 'the hero is matched without punctuation');
});

test('the name that is saved is cleaned, title-cased and carries the hero', () => {
  assert.equal(nameFor('  blue   glow  ', 'Anti-Mage', true), 'Anti-Mage Blue Glow');
  assert.equal(nameFor('blue glow', '', false), 'Blue Glow');
  assert.equal(nameFor('Синий свет', '', false), '');
});
