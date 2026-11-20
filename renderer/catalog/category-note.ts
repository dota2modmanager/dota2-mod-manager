/* The catalog maintainer's note on a category (constants.json `categoryNotes`): the line the
 * catalog's site prints above a category, such as the console command that brings emblems back or
 * the warning that "parts" mods carry CSS that can clash with a HUD. The app read none of them, so
 * a user here met those problems with no word about them.
 *
 * The note is the maintainer's HTML, and the window never takes outside HTML as markup: it is cut
 * into words, code and links here and drawn as text. A link to a category of the catalog's site
 * opens that category in the app instead. */

export type NotePart =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; cat?: string; url?: string };

type Notes = Record<string, { enabled?: boolean; text?: string } | undefined>;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
/** Words only: entities decoded first, then tags cut until none are left (one pass leaves "<script"
 *  behind "<scr<b>ipt"), then any stray bracket dropped, so nothing that reads as a tag survives. */
const plain = (html: string): string => {
  let s = html.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e] ?? '');
  for (let before = ''; before !== s;) { before = s; s = s.replace(/<[^<>]*>/g, ''); }
  return s.replace(/[<>]/g, '');
};

/** Where a link in a note goes: a catalog category by its id, or an https page, or nowhere. */
function target(href: string): { cat?: string; url?: string } {
  let u: URL;
  try { u = new URL(plain(href)); } catch { return {}; }
  if (u.protocol !== 'https:') return {};
  const cat = u.searchParams.get('category');
  return cat && !u.searchParams.get('mod') ? { cat } : { url: u.href };
}

/** A note's HTML cut into parts the window draws as text. */
export function noteParts(html: string): NotePart[] {
  const parts: NotePart[] = [];
  const push = (p: NotePart) => { if (p.text) parts.push(p); };
  const re = /<a\s[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>|<code>([\s\S]*?)<\/code>/gi;
  let at = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    push({ kind: 'text', text: plain(html.slice(at, m.index)) });
    if (m[1] !== undefined) {
      const to = target(m[1]);
      push(to.cat || to.url ? { kind: 'link', text: plain(m[2]), ...to } : { kind: 'text', text: plain(m[2]) });
    } else push({ kind: 'code', text: plain(m[3]) });
    at = re.lastIndex;
  }
  push({ kind: 'text', text: plain(html.slice(at)) });
  return parts;
}

/** The note the catalog has switched on for this category, or null. */
export function categoryNote(notes: unknown, cat: string): NotePart[] | null {
  const n = (notes && typeof notes === 'object' ? (notes as Notes)[cat] : undefined);
  if (!n || n.enabled === false || typeof n.text !== 'string' || !n.text.trim()) return null;
  const parts = noteParts(n.text);
  return parts.length ? parts : null;
}
