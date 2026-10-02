// KeyValues navigation for items_game.txt (src/schema.ts): finding a block's braces and walking
// its children without parsing the whole file. The table is 50 MB and only a few blocks of it are
// ever needed, so nothing here builds a tree. Text is latin1, byte for byte.
import { t } from './i18n.ts';

/** A block's braces in the text: [open, close + 1]. */
export type Bounds = [number, number];

/** One direct child of a KeyValues block: a nested block, or a key with a value. See eachChild. */
export type KvChild =
  | { key: string; start: number; end: number; isBlock: true; value: null; body: Bounds }
  | { key: string; start: number; end: number; isBlock: false; value: string; body: null };


// ---------- KeyValues navigation (no full parse: 50 MB, and we only need blocks) ----------

// Skip whitespace and // line comments starting at i.
export function skipGap(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) return text.length;
      i = nl + 1;
      continue;
    }
    return i;
  }
}

// Read a token (quoted or bare) at i. Returns { value, start, next } or null at a closing brace.
export function readToken(text: string, i: number): { value: string; start: number; next: number } | null {
  i = skipGap(text, i);
  if (i >= text.length || text[i] === '}') return null;
  if (text[i] === '"') {
    const end = text.indexOf('"', i + 1);
    if (end === -1) throw new Error(t('items_game: незакрытая кавычка'));
    return { value: text.slice(i + 1, end), start: i, next: end + 1 };
  }
  let end = i;
  while (end < text.length && !/[\s{}"]/.test(text[end])) end++;
  return { value: text.slice(i, end), start: i, next: end };
}

/**
 * Bounds of the { ... } block that starts at (or after) i.
 */
export function blockBounds(text: string, i: number): Bounds {
  const open = text.indexOf('{', i);
  if (open === -1) throw new Error(t('items_game: не найдено открытие блока'));
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    const c = text[k];
    if (c === '"') { const e = text.indexOf('"', k + 1); if (e === -1) break; k = e; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return [open, k + 1]; }
  }
  throw new Error(t('items_game: незакрытый блок'));
}

/**
 * Walk the direct children of a block.
 * @param bounds  from blockBounds()
 */
export function eachChild(text: string, bounds: Bounds, fn: (child: KvChild) => void): void {
  let i = bounds[0] + 1;
  const end = bounds[1] - 1;
  while (i < end) {
    const key = readToken(text, i);
    if (!key) break;
    const at = skipGap(text, key.next);
    if (text[at] === '{') {
      const b = blockBounds(text, at);
      fn({ key: key.value, start: key.start, end: b[1], isBlock: true, value: null, body: b });
      i = b[1];
    } else {
      const val = readToken(text, at);
      if (!val) break;
      fn({ key: key.value, start: key.start, end: val.next, isBlock: false, value: val.value, body: null });
      i = val.next;
    }
  }
}
