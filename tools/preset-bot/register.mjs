/*
 * Tell Discord which commands the preset bot answers (tools/preset-bot/worker.mjs): `/preset` with
 * a link, and "Show preset" in a message's Apps menu. Run once, and again whenever this list
 * changes; Discord replaces the whole set with what is sent.
 *
 *   DISCORD_APP_ID=<application id> DISCORD_BOT_TOKEN=<bot token> node tools/preset-bot/register.mjs
 */

/** The commands, with Russian names and descriptions for a Russian Discord. */
export const COMMANDS = [
  {
    type: 1,
    name: 'preset',
    name_localizations: { ru: 'пресет' },
    description: 'Show what is in a Dota 2 Mod Manager preset link',
    description_localizations: { ru: 'Показать, что внутри ссылки на пресет Dota 2 Mod Manager' },
    options: [{
      type: 3,
      name: 'link',
      name_localizations: { ru: 'ссылка' },
      description: 'The preset link',
      description_localizations: { ru: 'Ссылка на пресет' },
      required: true,
    }],
    // usable in servers, in DMs with the bot and in private channels once the app is installed
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    type: 3,
    name: 'Show preset',
    name_localizations: { ru: 'Показать пресет' },
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

if (import.meta.main) {
  const app = process.env.DISCORD_APP_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!app || !token) {
    console.error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN.');
    process.exit(1);
  }
  const r = await fetch(`https://discord.com/api/v10/applications/${app}/commands`, {
    method: 'PUT',
    headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(COMMANDS),
  });
  console.log(r.ok ? `registered ${COMMANDS.length} commands` : `Discord said ${r.status}: ${await r.text()}`);
  if (!r.ok) process.exit(1);
}
