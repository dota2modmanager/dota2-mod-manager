/* Who made a mod, as the catalog credits them.
 *
 * The catalog names people in a mod's links, in three roles: "author", "modded" (somebody who
 * reworked another author's mod) and "sender" (who brought it to the catalog). Each carries a
 * name rather than an address, and the catalog's constants map a name to a page (MOD_AUTHOR,
 * MOD_SENDER) where it has one.
 *
 * The mod window used to show the first author and nobody else, and put the other roles among
 * the link buttons, where a name was opened as an address and answered 404. On 2026-09-24, 40
 * mods in the catalog credited two people or more: Earthshaker Arcana names two authors, and
 * 24 mods name a modder beside the author whose work they changed.
 */

/** The roles, in the order they are shown: whoever made it before whoever changed or sent it. */
const CREDIT_ROLES = ['author', 'modded', 'sender'] as const;
export type CreditRole = typeof CREDIT_ROLES[number];
export const isCreditRole = (t: unknown): t is CreditRole => (CREDIT_ROLES as readonly unknown[]).includes(t);

export interface Credit { role: CreditRole; name: string; href: string | null }

/** What a credit is read from: the mod's links, and the catalog's name-to-page tables. */
interface Credited { links?: unknown; author?: string; sender?: string }
interface CreditPages { MOD_AUTHOR?: Record<string, string>; MOD_SENDER?: Record<string, string> }

/**
 * @param mod       a catalog mod: its `links`, and the older `author` / `sender` fields
 * @param constants the catalog's constants, for MOD_AUTHOR and MOD_SENDER
 */
export function modCredits(mod: Credited | null | undefined, constants: CreditPages | null = {}): Credit[] {
  const pageOf = (name: string) => constants?.MOD_AUTHOR?.[name] || constants?.MOD_SENDER?.[name] || null;
  const out: Credit[] = [];
  const seen = new Set<string>();
  const add = (role: CreditRole, raw: unknown, label?: unknown) => {
    const url = String(raw || '').trim();
    if (!url) return;
    const isUrl = /^https?:\/\//i.test(url);
    // an address with no name beside it is still somebody: say where it goes
    const name = isUrl ? (String(label || '').trim() || hostOf(url)) : url;
    const key = `${role}\n${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ role, name, href: isUrl ? url : pageOf(name) });
  };
  const links: { type?: string; url?: string; name?: string }[] = Array.isArray(mod?.links) ? mod.links : [];
  for (const role of CREDIT_ROLES) {
    if (role === 'author' && mod?.author) add('author', mod.author);
    for (const l of links) if (l && l.type === role) add(role, l.url, l.name);
    if (role === 'sender' && mod?.sender) add('sender', mod.sender);
  }
  return out;
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}
