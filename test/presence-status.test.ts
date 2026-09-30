/* The Discord status (src/presence-status.ts): what it says, in which language, and that the
 * setting turns the connection off rather than only the updates. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createPresenceStatus, presenceActivity } from '../src/presence-status.ts';
import { getLang, setLang } from '../src/i18n.ts';
import type { Activity } from '../src/discord-presence.ts';

// Russian unless a test says otherwise, and whatever it was before once they are done
const before = getLang();
test.beforeEach(() => setLang('ru'));
test.after(() => setLang(before));

function stand({ discordPresence = true as boolean, enabled = [true, true, false], masterOff = false, broken = false } = {}) {
  const log: string[] = [];
  const sent: Activity[] = [];
  const presence = {
    enabled: false,
    start() { this.enabled = true; log.push('start'); },
    stop() { this.enabled = false; log.push('stop'); },
    set(a: Activity) { sent.push(a); },
  };
  const status = createPresenceStatus({
    presence: presence as never,
    settings: { get: ((k: string) => (k === 'discordPresence' ? discordPresence : null)) as never },
    library: { list: () => { if (broken) throw new Error('no library'); return enabled.map((on, i) => ({ id: String(i), enabled: on })) as never; } },
    installer: { masterIsOff: () => masterOff },
  });
  return { status, presence, log, sent };
}

test('the status counts the mods that are on and names the screen', () => {
  const s = stand();
  s.status.setView('library');
  s.status.apply();
  assert.deepEqual(s.log, ['start']);
  assert.equal(s.sent[0].details, 'В своей библиотеке');
  assert.equal(s.sent[0].state, '2 модов включено');
});

test('with the master switch off it says the mods are off, whatever the records say', () => {
  const s = stand({ masterOff: true });
  s.status.apply();
  assert.equal(s.sent[0].state, 'Моды выключены');
});

test('turning the setting off closes the connection instead of sending one more status', () => {
  const s = stand({ discordPresence: false });
  s.status.apply();
  assert.deepEqual(s.log, ['stop']);
  assert.deepEqual(s.sent, []);
  s.status.refresh();
  assert.deepEqual(s.sent, [], 'a refresh while it is off sends nothing');
});

test('a library that cannot be read yet is "no mods", not a crash', () => {
  const s = stand({ broken: true });
  s.status.apply();
  assert.equal(s.sent[0].state, 'Ещё без модов');
});

test('an English interface gets an English status, and an unknown screen reads as the catalog', () => {
  setLang('en');
  const a = presenceActivity({ view: 'nowhere', mods: 3, masterOff: false });
  assert.equal(a.details, 'Browsing the mod catalog');
  assert.equal(a.state, '3 mods enabled');
  assert.deepEqual(a.buttons, [{ label: 'Get Mod Manager', url: 'https://dota2modmanager.com/' }]);
});
