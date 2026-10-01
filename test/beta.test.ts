/* Who the beta channel is offered to, and which update feed a copy reads.
 *
 * The rule the maintainer set: he picks the testers himself, by Discord account. So the answer has
 * to survive the ways a person stops being a tester without anybody touching their machine - taken
 * off the list, signed out of Discord - and it must never offer an unreleased build to somebody
 * the list does not name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import * as beta from '../src/beta.ts';
import remoteConfig from '../src/remote-config.js';

const { normalize } = remoteConfig;
/** The beta block normalize() keeps, as the tests below read it. */
const betaOf = (raw: unknown) => normalize(raw).beta as { salt: string; ids: string[] } | null;

const SALT = 'd2mm-beta-1';
const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const listFor = (...ids: string[]) => ({ salt: SALT, ids: ids.map((id) => beta.idHash(id, SALT)) });

test('the list holds hashes, and the hash is the salt and the id', () => {
  assert.equal(beta.idHash('123456789012345678', SALT), sha(`${SALT}:123456789012345678`));
  assert.notEqual(beta.idHash('123456789012345678', SALT), sha('123456789012345678'), 'the salt is part of it');
  assert.equal(beta.idHash(' 123456789012345678 ', SALT), beta.idHash('123456789012345678', SALT), 'a stray space is not a different account');
  assert.equal(beta.idHash(123456789012345678n.toString(), SALT).length, 64);
});

test('only an account on the list is a tester', () => {
  const list = listFor('111', '222');
  assert.equal(beta.isTester('111', list), true);
  assert.equal(beta.isTester('222', list), true);
  assert.equal(beta.isTester('333', list), false, 'somebody else');
  assert.equal(beta.isTester('111', { salt: 'another salt', ids: list.ids }), false, 'the same id under a different salt');
  assert.equal(beta.isTester(null, list), false, 'nobody signed in');
  assert.equal(beta.isTester('111', null), false, 'no list at all');
  assert.equal(beta.isTester('111', { salt: SALT, ids: [] }), false, 'an empty list is not an open door');
  assert.equal(beta.isTester('111', { salt: SALT, ids: [beta.idHash('111', SALT).toUpperCase()] }), true, 'case does not decide');
});

test('the switch alone does not put anybody on the beta channel', () => {
  const list = listFor('111');
  assert.equal(beta.channelFor({ discordId: '111', beta: list, wanted: true }), 'beta');
  assert.equal(beta.channelFor({ discordId: '111', beta: list, wanted: false }), 'latest', 'switched off');
  assert.equal(beta.channelFor({ discordId: '999', beta: list, wanted: true }), 'latest', 'not on the list');
  assert.equal(beta.channelFor({ discordId: null, beta: list, wanted: true }), 'latest', 'signed out of Discord');
  assert.equal(beta.channelFor({ discordId: '111', beta: null, wanted: true }), 'latest', 'the list was taken away');
  assert.equal(beta.channelFor(), 'latest', 'nothing known at all');
});

test('a tester taken off the list goes back to stable, and comes back by being listed again', () => {
  /* Nothing has to be pushed to a machine for this: the list is in the signed config, which is
     re-read on its own, and the switch in settings stays where the user left it. */
  const wanted = true;
  assert.equal(beta.channelFor({ discordId: '111', beta: listFor('111'), wanted }), 'beta');
  assert.equal(beta.channelFor({ discordId: '111', beta: listFor('222'), wanted }), 'latest');
  assert.equal(beta.channelFor({ discordId: '111', beta: listFor('222', '111'), wanted }), 'beta');
});

test('the settings screen is told to show nothing to somebody who is not invited', () => {
  const list = listFor('111');
  assert.deepEqual(beta.betaState({ discordId: '111', beta: list, wanted: true }), { eligible: true, on: true, channel: 'beta' });
  assert.deepEqual(beta.betaState({ discordId: '111', beta: list, wanted: false }), { eligible: true, on: false, channel: 'latest' });
  assert.deepEqual(beta.betaState({ discordId: '999', beta: list, wanted: true }), { eligible: false, on: false, channel: 'latest' },
    'not invited: no switch, and the switch being on in settings changes nothing');
  assert.deepEqual(beta.betaState({}), { eligible: false, on: false, channel: 'latest' });
});

// ---------- the block in the signed config ----------

test('the config reads a beta list, and refuses anything that is not one', () => {
  const ids = listFor('111', '222').ids;
  assert.deepEqual(normalize({ beta: { salt: SALT, ids } }).beta, { salt: SALT, ids });

  const mixed = betaOf({ beta: { salt: SALT, ids: [ids[0], 'not a hash', 42, null, ids[1].toUpperCase()] } });
  assert.deepEqual(mixed?.ids, [ids[0], ids[1]], 'entries that are not hashes are dropped, case is levelled');

  for (const raw of [{}, { beta: null }, { beta: 'yes' }, { beta: { ids: [] } }, { beta: { ids: ['nope'] } }, { beta: { salt: SALT } }]) {
    assert.equal(normalize(raw).beta, null, `${JSON.stringify(raw)} is not a list`);
  }
});

test('a list longer than a beta could plausibly be is cut', () => {
  const many = Array.from({ length: 150 }, (_, i) => beta.idHash(String(i), SALT));
  assert.equal(betaOf({ beta: { salt: SALT, ids: many } })?.ids.length, 100);
});

test('a config that says nothing about a beta leaves every other key alone', () => {
  const out = normalize({ features: { install: { off: true, ru: 'нет', en: 'no' } }, notices: [], blocks: [] });
  assert.equal(out.beta, null);
  assert.deepEqual((out.features as Record<string, unknown>).install, { off: true, ru: 'нет', en: 'no' });
});
