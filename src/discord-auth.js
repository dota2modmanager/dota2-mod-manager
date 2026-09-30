// Sign in with Discord, without a server of our own.
//
// Discord's authorization-code flow needs the client secret on the token exchange, and a
// secret cannot live in an app that ships to users — that flow needs a backend. Discord
// still supports the implicit grant, which hands the access token straight to the redirect,
// so a desktop app can identify a user with nothing but a public client id. That is what
// this does.
//
// What that buys and what it costs, plainly:
//  - the password is only ever typed into the user's own browser on discord.com; the app
//    never sees credentials, and there is no secret in the build to steal;
//  - the token arrives in the URL *fragment*, which browsers do not send to the server, so
//    the loopback page has to hand it back to us with a fetch;
//  - there is no refresh token, and we don't want one: the token is used once to read the
//    account name and is then dropped on the floor. Nothing long-lived is stored, so there
//    is nothing here for malware to lift later.
//  - the identity this produces is trusted by THIS app only. A nickname written into a
//    shared preset is just text; proving who made a preset needs a server that verifies
//    the token with Discord, and that comes with the community catalog.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const { t } = require('./i18n.ts');

// Public by design in OAuth2 — it identifies the app, it is not a secret, and it ships in
// every OAuth request anyway. The client SECRET is a different thing and is never needed
// here: the implicit grant doesn't use one, so none exists in this repo.
// REDIRECT_URI below must be listed verbatim under OAuth2 -> Redirects for this app.
const CLIENT_ID = '1529830456697163867';

// Discord matches redirect URIs exactly, so the port can't be random.
const PORT = 53174;
const HOST = '127.0.0.1';
const REDIRECT_URI = `http://${HOST}:${PORT}/callback`;
const TIMEOUT_MS = 3 * 60 * 1000;
const AVATAR_MAX = 256 * 1024;

function isConfigured() { return !!CLIENT_ID; }

// served on the loopback: pulls the token out of the fragment and posts it back to us
const CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>Dota 2 Mod Manager</title>
<style>body{font:15px/1.6 system-ui,sans-serif;background:#0e0e14;color:#e8e6f0;display:grid;place-items:center;height:100vh;margin:0}
.b{text-align:center;max-width:420px;padding:28px}.m{color:#a99ee0}</style>
<div class="b"><h2 id="h">Готово</h2><p class="m" id="p">Можно закрыть эту вкладку и вернуться в Mod Manager.</p></div>
<script>
  var f = location.hash.slice(1);
  if (!f) { document.getElementById('h').textContent = 'Не получилось';
            document.getElementById('p').textContent = 'Ответ Discord пришёл без токена.'; }
  else { fetch('/token', { method: 'POST', body: f }).catch(function () {}); }
</script>`;

const page = (res, body, code = 200) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

// Wait on the loopback for Discord to come back. Resolves with the access token.
function awaitToken(state) {
  return new Promise((resolve, reject) => {
    let done = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${HOST}:${PORT}`);
      if (req.method === 'GET' && url.pathname === '/callback') return page(res, CALLBACK_PAGE);
      if (req.method === 'POST' && url.pathname === '/token') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
        req.on('end', () => {
          res.writeHead(204).end();
          const q = new URLSearchParams(body);
          if (q.get('state') !== state) return finish(new Error(t('Ответ Discord не совпал с запросом')));
          const token = q.get('access_token');
          if (!token) return finish(new Error(q.get('error_description') || t('Discord не выдал токен')));
          finish(null, token);
        });
        return undefined;
      }
      return page(res, 'Not found', 404);
    });

    const finish = (err, token) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      if (err) reject(err); else resolve(token);
    };
    const timer = setTimeout(() => finish(new Error(t('Вход занял слишком много времени'))), TIMEOUT_MS);

    server.on('error', (/** @type {NodeJS.ErrnoException} */ err) => finish(err.code === 'EADDRINUSE'
      ? new Error(t('Порт {0} занят — закрой другой вход и попробуй снова', PORT))
      : err));
    server.listen(PORT, HOST); // loopback only: never reachable from the network
  });
}

// Discord's avatar CDN isn't in the renderer's CSP, and shouldn't be — fetch the picture
// here once and keep it as a data URI, so the UI never talks to Discord at all.
async function avatarDataUri(user) {
  if (!user.avatar) return null;
  try {
    const res = await fetch(`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > AVATAR_MAX) return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Opens the system browser, waits for the redirect, and returns who signed in.
 * @returns {Promise<{id: string, username: string, avatar: string|null}>}
 */
async function signIn() {
  if (!isConfigured()) throw new Error(t('Вход через Discord пока не настроен в этой сборке'));
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
    response_type: 'token',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'identify',            // name and avatar, nothing else: no email, no servers
    state,
    prompt: 'consent',
  });

  const pending = awaitToken(state);
  await shell.openExternal(authUrl);
  const token = await pending;

  const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(t('Discord не отдал профиль (HTTP {0})', res.status));
  const user = await res.json();
  // the token has done its one job; it is never written to disk
  return {
    id: String(user.id),
    username: String(user.global_name || user.username || '').slice(0, 80),
    avatar: await avatarDataUri(user),
  };
}

module.exports = { signIn, isConfigured, CLIENT_ID, REDIRECT_URI, PORT };
