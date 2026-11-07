import fs from 'node:fs';
import path from 'node:path';

/** VRF exports sheet sequences as name_seqN_frame.png or name_seqN.png. */
export function spriteFrames(root: string, texture: string): { key: string; file: string }[] {
  const base = path.join(root, texture.replace(/\.vtex$/, ''));
  const dir = path.dirname(base), stem = path.basename(base).toLowerCase();
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const found = files.flatMap((file) => {
    if (!file.toLowerCase().startsWith(`${stem}_seq`)) return [];
    const match = /^_seq(\d+)(?:_(\d+))?\.png$/i.exec(file.slice(stem.length));
    return match ? [{ sequence: Number(match[1]), frame: Number(match[2] ?? 0), file: path.join(dir, file) }] : [];
  }).sort((a, b) => a.sequence - b.sequence || a.frame - b.frame);
  let bytes = 0;
  return found.slice(0, 4096).flatMap(({ sequence, frame, file }) => {
    bytes += fs.statSync(file).size;
    return bytes > 128 * 1024 * 1024 ? [] : [{ key: `${texture}#seq=${sequence}&frame=${frame}`, file }];
  });
}
