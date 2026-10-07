/* esc(): text made safe to put into HTML. Every template literal that interpolates a mod name, an
 * author or a file path runs through it, because catalog data is third-party content and lands in
 * innerHTML. Forgetting it is an injection, not a typo.
 *
 * On its own, without the window, so the pure readers that use it (renderer/ui/notes-markdown.ts)
 * can be tested under plain node. renderer/ui/format.ts hands it on to everything else. */

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ENTITY[c] || c);
}
