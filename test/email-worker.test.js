/* The project mailbox (tools/email-worker/worker.js): a letter to hello@ or security@ goes whole
 * to every maintainer, and a line about it to a private Discord channel.
 *
 * Every maintainer gets a copy since there are two: FORWARD_TO names the first mailbox, a secret
 * FORWARD_ALSO the rest. One copy that cannot be sent must not stop the others, and the line has
 * to say which one did not go.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/** A message as Email Routing hands it over, keeping the addresses it was forwarded to. */
function letter({ refuse = [] } = {}) {
  const sent = [];
  return {
    sent,
    from: 'someone@example.com',
    to: 'security@dota2modmanager.com',
    rawSize: 4096,
    headers: new Headers({ subject: 'A report', 'authentication-results': 'mx; spf=pass; dkim=pass' }),
    forward: async (to) => {
      if (refuse.includes(to)) throw new Error('destination address not verified');
      sent.push(to);
    },
  };
}

/** Run the handler and hand back the Discord line it posted. */
async function deliver(env, message) {
  const { default: worker } = await import('../tools/email-worker/worker.js');
  const posted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { posted.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); };
  const waits = [];
  try {
    await worker.email(message, { DISCORD_WEBHOOK: 'https://discord.test/hook', ...env }, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  } finally {
    globalThis.fetch = realFetch;
  }
  return posted[0].embeds[0];
}

test('every maintainer gets the letter: the first mailbox and each one in the secret', async () => {
  const m = letter();
  const line = await deliver({ FORWARD_TO: 'misha@example.com', FORWARD_ALSO: ' nikita@example.com, misha@example.com ,' }, m);
  assert.deepEqual(m.sent.sort(), ['misha@example.com', 'nikita@example.com'], 'each once, blanks and repeats left out');
  assert.match(line.description, /in the mailboxes it was forwarded to/);
  assert.equal(line.title, 'A report');
});

test('a copy that cannot be sent does not stop the others, and the line names it', async () => {
  const m = letter({ refuse: ['nikita@example.com'] });
  const line = await deliver({ FORWARD_TO: 'misha@example.com', FORWARD_ALSO: 'nikita@example.com' }, m);
  assert.deepEqual(m.sent, ['misha@example.com']);
  assert.match(line.description, /Not every copy went.*nikita@example\.com.*not verified/);
  assert.equal(line.color, 0xe0533d, 'shown in red');
});

test('when no copy goes, the line says the message is only there', async () => {
  const m = letter({ refuse: ['misha@example.com'] });
  const line = await deliver({ FORWARD_TO: 'misha@example.com' }, m);
  assert.deepEqual(m.sent, []);
  assert.match(line.description, /Not forwarded.*The message is only here/);
});

test('the recipients are read from the two settings in order', async () => {
  const { recipientsOf } = await import('../tools/email-worker/worker.js');
  assert.deepEqual(recipientsOf({ FORWARD_TO: 'a@x', FORWARD_ALSO: 'b@x,c@x' }), ['a@x', 'b@x', 'c@x']);
  assert.deepEqual(recipientsOf({ FORWARD_TO: 'a@x' }), ['a@x']);
  assert.deepEqual(recipientsOf({}), []);
});
