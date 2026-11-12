# The preset bot

A Discord app that shows what is inside a preset link. Somebody posts
`https://dota2modmanager.com/p/#...` in a channel, you right-click the message, pick
**Apps → Show preset**, and the bot answers with the preset's mods, up to four covers and a button
that opens it. `/preset link:<link>` does the same for a link you paste.

It runs on Discord's HTTP interactions, so it is a Cloudflare Worker with nothing to keep running.
It cannot read the channel by itself and only answers when asked. `worker.mjs` decodes the link the way
the app does (`src/preset-link.ts`), and `test/preset-bot.test.ts` holds the two to the same answers.
Names, covers and mod pages come from the site's public `/catalog/data.json`.

## What it runs on

| Piece | Name | Notes |
| --- | --- | --- |
| Worker | `d2mm-preset-bot` | custom domain `bot.dota2modmanager.com` |
| Secret | `DISCORD_PUBLIC_KEY` | the application's public key, from the Developer Portal |

## Setting it up

1. Create an application at https://discord.com/developers/applications and add a bot to it.
2. From this folder, with wrangler logged in to the account that owns the domain:

   ```
   npx wrangler secret put DISCORD_PUBLIC_KEY      # General Information → Public Key
   npx wrangler deploy
   ```

3. In the portal, set **Interactions Endpoint URL** to `https://bot.dota2modmanager.com/`.
   Discord sends a signed ping and saves the address only if the worker answers it.
4. Register the commands, with the application id and the bot's token:

   ```
   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node tools/preset-bot/register.mjs
   ```

5. Invite it to a server with the `applications.commands` scope (Installation → Guild Install).
   It needs no permissions: it replies to the interaction, not by posting.

Mod names in the reply link to their pages on the site, in the language of the Discord client
that asked.
