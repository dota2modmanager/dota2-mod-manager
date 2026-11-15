/**
 * A Google service account key, signed into an access token.
 *
 * No library for this: the exchange is one JWT and one POST, and pulling in a dependency to make a
 * single signature would put a supply chain between this project and a weekly report. Used by the
 * search report and by the daily check that the key still works.
 *
 * The key's private half signs the assertion and never appears in an error message.
 */
import crypto from 'node:crypto';

export async function googleAccessToken(keyJson, scope) {
  let key;
  try {
    key = JSON.parse(keyJson);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not JSON');
  }
  if (!key.client_email || !key.private_key) throw new Error('that JSON has no client_email or private_key');

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(key.private_key).toString('base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) throw new Error(`token: HTTP ${res.status} ${String(json.error_description || json.error || '').slice(0, 160)}`);
  return json.access_token;
}
