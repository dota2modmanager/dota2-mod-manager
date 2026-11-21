# The pumpkin's keys

A Cloudflare Worker at `https://pumpkin.dota2modmanager.com` that hands out one key per caught
runner on the site and lets each key be spent by one install of the app. What it does and why is
at the top of `worker.mjs`.

## What it runs on

| Piece | Name | Notes |
| --- | --- | --- |
| Worker | `d2mm-pumpkin` | custom domain `pumpkin.dota2modmanager.com` |
| D1 | `d2mm-pumpkin` | `schema.sql`: spent tickets and handed-out keys |
| R2 | `d2mm-pumpkin` | empty since 2026-11-21, no longer bound to the worker |
| Secrets | `TICKET_SECRET`, `ADDR_SALT` | random, 32 bytes each |

## Setting it up again

From this folder, with wrangler logged in to the account that owns the domain:

```
npx wrangler d1 create d2mm-pumpkin            # put the id in wrangler.jsonc
npx wrangler d1 execute d2mm-pumpkin --remote --file schema.sql
npx wrangler secret put TICKET_SECRET
npx wrangler secret put ADDR_SALT
npx wrangler deploy
```

Until 2026-11-21 the bucket held the prize, Necrophos Scream, with and without a Russian voice,
and `GET /mod` handed it to the install that spent the key. Halloween over, the mod went to the
catalog as one mod with two styles, the bucket was emptied, and `/mod` answers 410. The key still
opens the bloody theme.
