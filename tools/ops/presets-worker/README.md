# Community presets

People publish their presets from the app and vote on each other's. The presets and the votes
are JSON files in the `community-presets` branch of this repository; nothing is kept anywhere
else. A Cloudflare Worker at `https://presets.dota2modmanager.com` is the only thing that writes
to the branch, because writing needs a key the app cannot carry. What it does and why is at the
top of `worker.mjs`.

```
app ── POST /presets, /votes ──▶ worker ── GitHub contents API ──▶ community-presets: presets/, votes/
                                    └── workflow_dispatch ──▶ community-presets.yml ── index.mjs ──▶ index.json
app ◀──────────────── raw.githubusercontent.com/…/community-presets/index.json (or a mirror) ─────────┘
```

## What it runs on

| Piece | Name | Notes |
| --- | --- | --- |
| Worker | `d2mm-presets` | custom domain `presets.dota2modmanager.com` |
| Branch | `community-presets` | created by the first manual run of the workflow |
| Workflow | `.github/workflows/community-presets.yml` | rebuilds `index.json`; on dispatch and every 30 minutes |
| Secret `GITHUB_TOKEN` | fine-grained token | this repository only; Contents: read and write, Actions: read and write |
| Secrets `SESSION_SECRET`, `USER_SECRET` | random, 32 bytes each | `USER_SECRET` names people in the branch: changing it makes everybody a stranger to their old votes |
| Secret `SIGNING_KEY` | ed25519, PKCS#8 in base64 | its public half is `COMMUNITY_PUBLIC_KEY` in `crates/mm-core/src/presets/community_presets.rs` |

## Setting it up

1. Run the **Community presets** workflow once by hand (Actions → Community presets → Run
   workflow). It creates the branch with empty `presets/` and `votes/`.
2. Make the signing key and put its public half in the app:

   ```
   openssl genpkey -algorithm ed25519 -outform DER | base64 -w0 > signing.b64     # SIGNING_KEY
   openssl pkey -inform DER -in <(base64 -d signing.b64) -pubout -outform DER | base64 -w0   # COMMUNITY_PUBLIC_KEY
   ```

3. From this folder, with wrangler logged in to the account that owns the domain:

   ```
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put USER_SECRET
   npx wrangler secret put SIGNING_KEY < signing.b64
   npx wrangler deploy
   ```

4. In `crates/mm-core/src/presets/community_presets.rs` set `COMMUNITY_PUBLIC_KEY`. The app
   shows community presets only when it has a key to check them with.

## Taking a preset down

Add its id (the file name in `presets/` without `.json`) to `hidden.json` in the branch and run the
workflow. The file stays in history; the app stops showing it at its next refresh. An author takes
their own down from the app.

## Limits

Per Discord account: 30 published presets, 5000 votes, accounts older than 14 days only. A code is
at most 64 KB, a name 80 characters, a description 500. For a flood of requests from one address,
add a rate-limiting rule for the route in the Cloudflare dashboard; the worker keeps no state to
count with.
