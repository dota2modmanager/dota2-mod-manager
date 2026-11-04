/*
 * A draft as the catalog takes it: the archive h6rd/PreMod makes, and the rules the catalog's
 * upload page (h6rd/Dota2PornFxWeb, upload.js) holds a mod to. An author who sends this archive
 * sends what rotten's own tool would have made, so nobody repacks it by hand.
 *
 * PreMod's archive, one per mod:
 *   <name>.zip    the VPK, zipped on its own
 *   <name>.webp   the preview, 854×480
 *   mod.json      the catalog entry: name, preview, file, tags, links
 *   hash.json     mod_name, and the sha256 of the VPK and of its zip
 * A mod with styles carries one zip and one preview per style, named `<name> <label>`, and lists
 * them in mod.json the way the catalog lists styles. What the upload form asks besides the files
 * (category, hero, description, the mod it updates) goes in submit.json, under the form's names.
 *
 * The rules are the upload page's: a Latin name with single spaces, 29 characters at most (39 for
 * the two heroes whose names are that long), the hero's name in it for a hero's mod, no more than
 * three styles with labels of 12 characters, and 100 MB for the whole archive.
 */
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { t } from './i18n.ts';

const MAX_ARCHIVE = 100 * 1024 * 1024;
/** The most looks one catalog mod may have. */
export const MAX_STYLES = 3;
const MAX_LABEL = 12;
// the categories whose mods belong to one hero, and the ones the upload page does not take
const HERO_CATEGORIES = ['heroes', 'hero-items', 'herofx', 'hero-sounds'];
const NOT_TAKEN = ['packs', 'cursors', 'tools', 'news', 'guides', 'sites', 'fonts', 'creeps'];
const NAME = /^[a-zA-Z0-9]+(?: [a-zA-Z0-9]+)*$/;
const LONG_HEROES = ['keeperofthelight', 'naturesprophet'];

const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What the draft needs to fit the catalog's rules, beyond what is still missing, in words. */
export function catalogProblems(d: { name: string; category: string; hero: string; styles: { label: string }[] }): string[] {
  const out: string[] = [];
  const hero = bare(d.hero);
  const room = LONG_HEROES.includes(hero) ? 39 : 29;
  if (d.name && !NAME.test(d.name)) out.push(t('название латиницей и цифрами, через одиночные пробелы'));
  if (d.name.length > room) out.push(t('название не длиннее {0} символов', room));
  if (NOT_TAKEN.includes(d.category)) out.push(t('эта категория в каталог через загрузку не принимается'));
  if (HERO_CATEGORIES.includes(d.category) && hero && d.name && !bare(d.name).includes(hero)) out.push(t('имя героя в названии'));
  if (d.styles.length > MAX_STYLES) out.push(t('не больше {0} стилей', MAX_STYLES));
  if (d.styles.length > 1 && d.styles.some((s) => s.label.length > MAX_LABEL)) out.push(t('название стиля не длиннее {0} символов', MAX_LABEL));
  return out;
}

/** Is this a WebP picture, by its RIFF header. */
export const isWebp = (b: Buffer | Uint8Array | null | undefined): boolean =>
  Boolean(b && b.length > 12 && Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP');

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** One look of the mod, ready to pack: its label, its VPK, its WebP preview. */
interface PackedStyle { label: string; vpk: Buffer; preview: Buffer }

/** The archive PreMod would make of these files, with the form's fields beside it. */
export function premodArchive(d: { name: string; category: string; hero: string; description: string; author: string; replaces: { category: string; name: string } | null },
  styles: PackedStyle[]): { name: string; zip: Buffer } {
  const outer = new AdmZip();
  const named = styles.map((s, i) => {
    const base = i === 0 ? d.name : `${d.name} ${(s.label || String(i + 1)).replace(/[<>:"/\\|?*]/g, '_')}`;
    const inner = new AdmZip();
    inner.addFile(`${base}.vpk`, s.vpk);
    const zip = inner.toBuffer();
    outer.addFile(`${base}.zip`, zip);
    outer.addFile(`${base}.webp`, s.preview);
    return { label: s.label || null, file: `${base}.zip`, preview: `${base}.webp`, zip, vpk: s.vpk };
  });
  const author = /^https?:\/\//i.test(d.author) ? { type: 'author', url: d.author } : { type: 'author', name: d.author };
  const entry = {
    name: d.name,
    preview: named[0].preview,
    file: named[0].file,
    ...(named.length > 1 ? { styles: named.map((n) => ({ label: n.label, file: n.file, preview: n.preview })) } : {}),
    tags: {},
    links: [author],
  };
  outer.addFile('mod.json', Buffer.from(JSON.stringify(entry, null, 2)));
  outer.addFile('hash.json', Buffer.from(JSON.stringify({ mod_name: d.name, vpk_hash: sha256(named[0].vpk), vpk_zip_hash: sha256(named[0].zip) }, null, 2)));
  const submit = {
    mode: d.replaces ? 'update' : 'new',
    ...(d.replaces ? { existingName: d.replaces.name } : {}),
    category: d.replaces?.category || d.category,
    hero: d.hero || null,
    description: d.description || null,
  };
  outer.addFile('submit.json', Buffer.from(JSON.stringify(submit, null, 2)));
  const zip = outer.toBuffer();
  if (zip.length > MAX_ARCHIVE) throw new Error(t('Архив больше 100 МБ: каталог такой не примет'));
  return { name: `${d.name}.zip`, zip };
}
