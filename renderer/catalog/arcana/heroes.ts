/* The arcanas the window builds (src/arcana-service.ts WINDOWS), by the words the window shows:
 * the card's name among the tools and the hero under the item's name. */
export const ARCANA_WORDS: Record<string, { card: () => string; hero: () => string }> = {
  'terrorblade-arcana': { card: () => L`Аркана Террорблейда`, hero: () => L`Террорблейд` },
  'techies-arcana': { card: () => L`Аркана Течиса`, hero: () => L`Течис` },
  'terrorblade-span': { card: () => L`Крылья Террорблейда`, hero: () => L`Террорблейд` },
  'terrorblade-scythes': { card: () => L`Косы Террорблейда`, hero: () => L`Террорблейд` },
  'razor-crest': { card: () => L`Гребень Разора`, hero: () => L`Разор` },
};

/** The words for an arcana, its item name standing in for one this table has not heard of. */
export const arcanaWords = (set: string, name: string) => ARCANA_WORDS[set] ?? { card: () => name, hero: () => name };
