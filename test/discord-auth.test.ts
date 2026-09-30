/* Signing in with Discord (src/discord-auth.ts), the whole round trip with Discord played by fakes.
 *
 * The browser is a function that reads the authorisation URL the app opened and does what a browser
 * returning from Discord does: loads the loopback page and posts the fragment back. Discord's API is
 * a stand-in for fetch. What is checked is what the app promises in its header: it asks for the
 * account name and nothing else, it accepts only the answer to the request it made, and it keeps
 * nothing but the name and the picture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { signIn, REDIRECT_URI, PORT } from '../src/discord-auth.ts';
import { t as say } from '../src/i18n.ts';
import { withElectron } from './helpers/fake-electron.ts';

const realFetch = globalThis.fetch;

type Browser = (auth: URL) => Promise<void>;

/** A browser that comes back from Discord with `answer` in the fragment, `state` echoed unless told otherwise. */
const returning = (answer: (state: string) => string): Browser => async (auth) => {
  const back = new URL(auth.searchParams.get('redirect_uri')!);
  // the page that lifts the fragment; a real browser takes longer than the loopback needs to start
  for (let tries = 0; ; tries++) {
    try { await realFetch(back); break; } catch (err) {
      if (tries > 50) throw err;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  await realFetch(new URL('/token', back), { method: 'POST', body: answer(auth.searchParams.get('state')!) });
};

/** Discord's API as far as sign-in reads it. */
function discord({ status = 200, user = { id: '42', username: 'fleece', global_name: 'Fleece', avatar: 'abc' } as Record<string, unknown>, avatarBytes = 100 } = {}) {
  const asked: string[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return realFetch(input, init);
    asked.push(`${url} ${new Headers(init?.headers).get('authorization') || ''}`.trim());
    if (url.startsWith('https://discord.com/api/v10/users/@me')) return new Response(JSON.stringify(user), { status });
    if (url.startsWith('https://cdn.discordapp.com/avatars/')) return new Response(Buffer.alloc(avatarBytes));
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fake, asked };
}

async function run(browser: Browser, api = discord()) {
  globalThis.fetch = api.fake;
  try {
    return await withElectron({
      shell: { openExternal: async (u: string) => { void browser(new URL(u)); } },
    }, () => signIn());
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('the app asks Discord for the account name only, and comes back to its own loopback', async () => {
  let asked: URL | null = null;
  await run(async (auth) => { asked = auth; await returning((state) => `access_token=T&state=${state}`)(auth); });
  const url = asked as unknown as URL;
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('scope'), 'identify', 'no email, no server list');
  assert.equal(url.searchParams.get('response_type'), 'token', 'no client secret anywhere in the flow');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.match(REDIRECT_URI, /^http:\/\/127\.0\.0\.1:\d+\/callback$/, 'the loopback, never an address on the network');
  assert.match(url.searchParams.get('state') || '', /^[0-9a-f]{32}$/);
});

test('a sign-in comes back with the name Discord shows and the avatar as a picture, and the token is used once', async () => {
  const api = discord();
  const user = await run(returning((state) => `access_token=TOKEN123&state=${state}`), api);
  assert.equal(user.id, '42');
  assert.equal(user.username, 'Fleece', 'the display name before the handle');
  assert.match(user.avatar || '', /^data:image\/png;base64,/);
  assert.deepEqual(api.asked.filter((a) => a.includes('Bearer')), ['https://discord.com/api/v10/users/@me Bearer TOKEN123']);
  assert.ok(!JSON.stringify(user).includes('TOKEN123'), 'the token is not in what the app keeps');
});

test('an answer to somebody else\'s request is refused', async () => {
  await assert.rejects(
    () => run(returning(() => 'access_token=STOLEN&state=not-the-one-we-sent')),
    { message: say('Ответ Discord не совпал с запросом') },
  );
});

test('a refusal on Discord\'s side says what Discord said', async () => {
  await assert.rejects(
    () => run(returning((state) => `error=access_denied&error_description=The+user+denied+access&state=${state}`)),
    { message: 'The user denied access' },
  );
});

test('a profile Discord will not hand over is an error with its status', async () => {
  await assert.rejects(
    () => run(returning((state) => `access_token=T&state=${state}`), discord({ status: 401 })),
    { message: say('Discord не отдал профиль (HTTP {0})', 401) },
  );
});

test('no avatar, or one too big to keep, is no picture rather than a failure', async () => {
  const none = await run(returning((state) => `access_token=T&state=${state}`), discord({ user: { id: '1', username: 'handle', avatar: null } }));
  assert.equal(none.avatar, null);
  assert.equal(none.username, 'handle', 'the handle when there is no display name');
  const huge = await run(returning((state) => `access_token=T&state=${state}`), discord({ avatarBytes: 300 * 1024 }));
  assert.equal(huge.avatar, null);
});
