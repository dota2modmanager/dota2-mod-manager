# The pumpkin's keys

A Cloudflare Worker at `https://pumpkin.dota2modmanager.com` that hands out one key per caught
runner on the site and lets each key be spent by one install of the app. What it does and why is
at the top of `worker.mjs`; the tests are `test/pumpkin-worker.test.ts`.

## What it runs on

| Piece | Name | Notes |
| --- | --- | --- |
| Worker | `d2mm-pumpkin` | custom domain `pumpkin.dota2modmanager.com` |
| D1 | `d2mm-pumpkin` | `schema.sql`: spent tickets and handed-out keys |
| R2 | `d2mm-pumpkin` | private, no public address: the prize and its picture |
| Secrets | `TICKET_SECRET`, `ADDR_SALT` | random, 32 bytes each |

## Setting it up again

From this folder, with wrangler logged in to the account that owns the domain:

```
npx wrangler d1 create d2mm-pumpkin            # put the id in wrangler.jsonc
npx wrangler d1 execute d2mm-pumpkin --remote --file schema.sql
npx wrangler r2 bucket create d2mm-pumpkin
npx wrangler r2 object put d2mm-pumpkin/necrophos-scream.vpk --file <the mod> --remote
npx wrangler r2 object put d2mm-pumpkin/necrophos-scream.png --file <its picture> --remote
npx wrangler secret put TICKET_SECRET
npx wrangler secret put ADDR_SALT
npx wrangler deploy
```

Replacing the prize is the `r2 object put` again under the same name; installs that already have
it keep their copy.
