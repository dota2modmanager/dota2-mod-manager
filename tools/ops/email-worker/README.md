# The project mailbox

`hello@dota2modmanager.com` and `security@dota2modmanager.com` land here. Each message is
forwarded whole to the maintainer's mailbox, and a line about it goes to a private Discord
channel so it is seen the same day. [worker.js](worker.js) says why it carries only the headers.

Nothing here costs anything: Cloudflare Email Routing is free on a zone that is already there,
and a worker that handles a few messages a day stays inside the free plan.

## Switching it on, once

1. **Cloudflare, `dota2modmanager.com`, Email, Email Routing, Get started.** Cloudflare adds the
   MX and TXT records itself. Verify the destination address it asks for; that is the mailbox the
   mail is forwarded to.
2. **Deploy this worker**, from this folder:

   ```bash
   npx wrangler deploy
   npx wrangler secret put DISCORD_WEBHOOK
   ```

   The webhook is the one for the private channel the mail should ring in. Make a channel nobody
   else can read: a message to `security@` can describe a hole before it is fixed.

   Every maintainer gets a copy. `FORWARD_TO` in `wrangler.jsonc` is the first mailbox; the others
   go in a secret, comma-separated, so their personal addresses are not published here:

   ```bash
   npx wrangler email routing addresses create someone@example.com   # they confirm the email it sends
   npx wrangler secret put FORWARD_ALSO
   ```

   A copy that could not be sent is named on the Discord line, and the others still go.
3. **Email Routing, Routes, Create address.** Two of them, `hello` and `security`, each with the
   action *Send to a Worker* and this worker as the destination.
4. **Catch-all: Drop.** Everything else at the domain goes nowhere, which keeps the address list
   the two above and nothing a spammer guessed.

## Checking it works

Send a message to `hello@dota2modmanager.com` **from a mailbox other than the one it forwards
to**. The copy should arrive within a minute, and the channel should show one line with the
subject and who it came from.

From the same mailbox it forwards to, the copy never appears, and nothing is broken: the message
comes back with a Message-ID Gmail already has in Sent, and Gmail drops a duplicate without a
word. The line in Discord is the proof the worker ran; the line says so when a forward actually
failed. `npx wrangler tail` shows the rest.

## Sending from the address

Receiving is free and needs nothing else. Replying *as* `hello@dota2modmanager.com` needs an SMTP
sender, because Email Routing only receives: add the address in Gmail under **Send mail as** with
the SMTP details of a free sender (Resend, Brevo and others have a free tier that covers a few
thousand messages a month). Until that is set up, replies go out from the personal address, which
is fine for a conversation somebody started.

## What is published where

- `SECURITY.md`: `security@` as a second route for a vulnerability, beside the private advisory.
- `README.md` and the site: `hello@` as the way a person or a company reaches the project.
- `CODE_OF_CONDUCT.md`: `hello@` as the address that is not a public issue.

Those lines go in once the addresses answer, and not before: a published address that bounces is
worse than no address.
