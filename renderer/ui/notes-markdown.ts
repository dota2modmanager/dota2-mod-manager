/* The changelog section the "What's new" window shows (renderer/ui/dialog.ts), as HTML.
 *
 * The changelog is markdown, but only ever the shapes this app writes: "### heading", "- bullet",
 * paragraphs separated by a blank line, and **bold** or `code` inside a line. A full parser would
 * be a library for nothing. A blank line ends a paragraph as well as a list: until 2.8.0 it only
 * ended a list, and a section's second paragraph ran on into its first. */
import { esc } from './escape.ts';

export function notesHtml(md: string): string {
  const inline = (s: string) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out: string[] = [];
  let list: string[] | null = null;
  let para = false;
  const closeList = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); para = false; continue; }
    if (line.startsWith('###')) { closeList(); para = false; out.push(`<h4>${inline(line.replace(/^#+\s*/, ''))}</h4>`); continue; }
    if (line.startsWith('- ')) { para = false; (list = list || []).push(`<li>${inline(line.slice(2))}</li>`); continue; }
    // a wrapped bullet or paragraph line continues whatever came before it
    if (list) list[list.length - 1] = list[list.length - 1].replace(/<\/li>$/, ` ${inline(line)}</li>`);
    else if (para) out[out.length - 1] = out[out.length - 1].replace(/<\/p>$/, ` ${inline(line)}</p>`);
    else { out.push(`<p>${inline(line)}</p>`); para = true; }
  }
  closeList();
  return out.join('');
}
