/*
 * The author's drafts (issue #236, step 1): a mod being made for the catalog, kept on the author's
 * disk until it is ready, and then written out as the archive the catalog's own packer makes
 * (src/creator-premod.ts) for the catalog's maintainer. Nothing is uploaded: the catalog is not ours to write to, and an upload
 * service is the second step, decided with its maintainer.
 *
 * A draft is a folder under userData/creator/<id>/: draft.json and the files it names, copied in so
 * the draft survives the originals being moved. Each style is a look of the mod with its own VPK
 * and picture, the way the catalog lists styles.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { VPK_SIGNATURE } from './vpk-read.ts';
import { catalogProblems, isWebp, MAX_STYLES, premodArchive } from './creator-premod.ts';
import { t } from './i18n.ts';

/** One look of the mod: its label, its VPK and its picture, by file name inside the draft. */
export interface DraftStyle { label: string; vpk: string | null; picture: string | null }

/** A mod being made for the catalog. */
export interface Draft {
  id: string;
  name: string;
  category: string;
  hero: string;
  description: string;
  author: string;
  styles: DraftStyle[];
  /** the catalog mod this changes, when it is an update of a published one rather than a new one */
  replaces: { category: string; name: string } | null;
  updatedAt: number;
}

/** What the form may change; the rest is the store's. */
export type DraftFields = Partial<Pick<Draft, 'name' | 'category' | 'hero' | 'description' | 'author' | 'replaces'>> & { styles?: { label: string }[] };

const PICTURE = /\.(png|jpe?g|webp|gif|mp4|webm)$/i;
const MAX_TEXT = 2000;
const ID = /^[0-9a-f-]{36}$/;

const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The drafts under userDataDir/creator, and the archive one of them becomes. */
export function createCreator({ userDataDir }: { userDataDir: string }) {
  const root = path.join(userDataDir, 'creator');
  const folder = (id: string) => {
    if (!ID.test(id)) throw new Error(t('Черновик не найден'));
    return path.join(root, id);
  };
  const file = (id: string) => path.join(folder(id), 'draft.json');

  function read(id: string): Draft {
    try { return JSON.parse(fs.readFileSync(file(id), 'utf-8')) as Draft; } catch { throw new Error(t('Черновик не найден')); }
  }
  // two saves in one millisecond still come out in the order they were made
  let last = 0;
  function write(d: Draft): Draft {
    d.updatedAt = last = Math.max(Date.now(), last + 1);
    fs.mkdirSync(folder(d.id), { recursive: true });
    fs.writeFileSync(file(d.id), JSON.stringify(d, null, 2));
    return d;
  }

  /** Every draft, the one touched last first. */
  function list(): Draft[] {
    let ids: string[] = [];
    try { ids = fs.readdirSync(root).filter((n) => ID.test(n)); } catch { return []; }
    return ids.flatMap((id) => { try { return [read(id)]; } catch { return []; } }).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** A new draft, or the fields of one changed. A style dropped takes its files with it. */
  function save(id: string | null, fields: DraftFields): Draft {
    const d: Draft = id ? read(id) : {
      id: crypto.randomUUID(), name: '', category: '', hero: '', description: '', author: '', styles: [{ label: '', vpk: null, picture: null }], replaces: null, updatedAt: 0,
    };
    if (fields.name !== undefined) d.name = text(fields.name);
    if (fields.category !== undefined) d.category = text(fields.category, 60);
    if (fields.hero !== undefined) d.hero = text(fields.hero, 60);
    if (fields.description !== undefined) d.description = text(fields.description, MAX_TEXT);
    if (fields.author !== undefined) d.author = text(fields.author, 80);
    if (fields.replaces !== undefined) {
      const r = fields.replaces;
      d.replaces = r && text(r.category, 60) && text(r.name, 300) ? { category: text(r.category, 60), name: text(r.name, 300) } : null;
    }
    if (Array.isArray(fields.styles)) {
      const next = fields.styles.slice(0, MAX_STYLES).map((s, i) => ({ ...(d.styles[i] || { vpk: null, picture: null }), label: text(s?.label, 120) }));
      for (const gone of d.styles.slice(next.length)) dropFiles(d.id, gone);
      d.styles = next.length ? next : [{ label: '', vpk: null, picture: null }];
    }
    return write(d);
  }

  function dropFiles(id: string, s: DraftStyle) {
    for (const f of [s.vpk, s.picture]) if (f) fs.rmSync(path.join(folder(id), f), { force: true });
  }

  /** A style's VPK or picture, copied into the draft from where it is. Refuses anything else. */
  function attach(id: string, style: number, kind: 'vpk' | 'picture', from: string): Draft {
    const d = read(id);
    const s = d.styles[style];
    if (!s) throw new Error(t('Черновик не найден'));
    if (kind === 'vpk') {
      const head = Buffer.alloc(4);
      const fd = fs.openSync(from, 'r');
      try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
      if (head.readUInt32LE(0) !== VPK_SIGNATURE) throw new Error(t('Это не VPK-файл'));
    } else if (!PICTURE.test(from)) throw new Error(t('Картинка должна быть PNG, JPG, WebP, GIF или видео MP4/WebM'));
    const ext = kind === 'vpk' ? '.vpk' : path.extname(from).toLowerCase();
    const name = `${kind}-${style}-${crypto.randomBytes(3).toString('hex')}${ext}`;
    const old = s[kind];
    fs.copyFileSync(from, path.join(folder(id), name));
    if (old) fs.rmSync(path.join(folder(id), old), { force: true });
    s[kind] = name;
    return write(d);
  }

  function remove(id: string): void {
    fs.rmSync(folder(id), { recursive: true, force: true });
  }

  /** What is still missing before the draft can go to the catalog, in words for the author. */
  function missing(d: Draft): string[] {
    const out: string[] = [];
    if (!d.name) out.push(t('название'));
    if (!d.category) out.push(t('категория'));
    if (!d.author) out.push(t('автор'));
    d.styles.forEach((s, i) => {
      // one look is the mod itself; with several, each is named
      const which = d.styles.length > 1 ? ` ${s.label || i + 1}` : '';
      if (!s.vpk) out.push(which ? t('VPK стиля{0}', which) : 'VPK');
      if (!s.picture) out.push(which ? t('картинка стиля{0}', which) : t('картинка'));
      if (d.styles.length > 1 && !s.label) out.push(t('название стиля {0}', i + 1));
    });
    return out;
  }

  /**
   * The draft as the archive PreMod makes, for the catalog's maintainer. Each style's preview is the
   * WebP the window drew from its picture at 854x480; a style the window could not draw (a clip, or
   * a picture too big to show) takes its picture as it is when that is a WebP already. Refused while
   * something is missing or the catalog's rules say no.
   */
  function bundle(id: string, previews: (Uint8Array | null)[] = []): { name: string; zip: Buffer } {
    const d = read(id);
    const gaps = [...missing(d), ...catalogProblems(d)];
    if (gaps.length) throw new Error(t('Не хватает: {0}', gaps.join(', ')));
    const styles = d.styles.map((s, i) => {
      const drawn = previews[i];
      const own = fs.readFileSync(path.join(folder(id), s.picture!));
      const preview = isWebp(drawn) ? Buffer.from(drawn!) : isWebp(own) ? own : null;
      if (!preview) throw new Error(t('Каталогу нужна картинка-превью, а не видео: {0}', s.label || d.name));
      return { label: s.label, vpk: fs.readFileSync(path.join(folder(id), s.vpk!)), preview };
    });
    return premodArchive(d, styles);
  }

  return { list, save, attach, remove, missing, bundle, folder };
}

/** The store createCreator makes. */
export type Creator = ReturnType<typeof createCreator>;
