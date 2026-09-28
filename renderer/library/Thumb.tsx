/* A My mods row's picture (ui/thumb.js says where each comes from), and the pills after its name.
 * A picture fetched by name out of the game or the mod itself arrives when the row is near the
 * screen, through the same loader the catalog's cards use. */
import { Fragment, useEffect, useRef } from 'react';
import { watchIconFor } from '../ui/cosmetic-icons.js';
import { useCosmeticIcon } from '../catalog/cosmetic/CosmeticCard.tsx';
import type { PackRowModel, Tag, Thumb as ThumbModel } from './model.ts';

export function Thumb({ thumb, cls }: { thumb: ThumbModel; cls: string }) {
  if ('url' in thumb) {
    return thumb.video
      ? <video className={cls} src={thumb.url} muted playsInline preload="metadata" />
      : <img className={cls} src={thumb.url} loading="lazy" alt="" />;
  }
  if ('key' in thumb) return <Fetched name={thumb.key} icon={thumb.icon} cls={cls} />;
  return <div className={cls}>{thumb.icon && <span className="ms thumb-glyph">{thumb.icon}</span>}</div>;
}

/* Asked for once it scrolls near. A lookup that came back with nothing leaves the tile as it was
 * before it was asked: a mod with no picture must not turn into an empty box. */
function Fetched({ name, icon, cls }: { name: string; icon: string | null; cls: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const src = useCosmeticIcon(name);
  useEffect(() => (src === undefined && ref.current ? watchIconFor(ref.current, name) : undefined), [name, src]);
  if (src) return <img className={cls} src={src} loading="lazy" alt="" />;
  return (
    <div className={cls} ref={ref} data-name={src === undefined ? name : undefined} data-owned="react">
      {icon && <span className="ms thumb-glyph">{icon}</span>}
    </div>
  );
}

/** A cosmetic pick: its slot's glyph until the look's own picture arrives. */
export function CosmeticThumb({ name, icon }: { name: string; icon: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const src = useCosmeticIcon(name);
  useEffect(() => (ref.current ? watchIconFor(ref.current, name) : undefined), [name]);
  return (
    <div className="lib-thumb" data-name={name} data-owned="react" ref={ref}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="ms thumb-glyph">{icon}</span>}
    </div>
  );
}

/* A pack's first four members in a 2x2 grid. When not one of them has a picture, four empty boxes
 * say nothing a single "several heroes in one" stand-in would not say better. */
export function PackThumb({ p }: { p: PackRowModel }) {
  if (!p.cells) return <Thumb thumb={p.standIn} cls="lib-thumb" />;
  return (
    <div className="lib-thumb pack-thumb-grid">
      {p.cells.map((c, i) => (
        !c ? <div key={i} className="pack-thumb-cell" />
          : 'icon' in c ? <div key={i} className="pack-thumb-cell"><span className="ms">{c.icon}</span></div>
            : c.video ? <video key={i} src={c.url} muted playsInline preload="metadata" />
              : <img key={i} src={c.url} loading="lazy" alt="" />
      ))}
    </div>
  );
}

/** The pills after a name, each after a space, as the name line has always spaced them. */
export function Tags({ tags }: { tags: Tag[] }) {
  return (
    <>
      {tags.map((t, i) => (
        <Fragment key={i}>
          {' '}
          <span className={t.cls ? `lib-tag ${t.cls}` : 'lib-tag'} title={t.title}>
            {t.icon && <span className="ms">{t.icon}</span>}
            {t.text}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/* The mod's file, named exactly as in the mods folder. Selectable on purpose: this is the one
 * string on the row somebody copies, to go and find the file or to paste it into a question. */
export function PakFile({ name }: { name: string }) {
  return <span className="lib-pak selectable" title={L`Файл в папке модов`}>{name}</span>;
}

/* The handle you drag to change the load order. Only a row in a numbered pak gets one; a font, a
 * cursor and a cosmetic pick get an empty space of the same width, so the thumbnails stay a
 * column. Not in the tab order and not announced: the same two moves are in the row's own menu,
 * which is the path that works without a pointer. */
export function Grip({ id, order }: { id: string; order: number | null }) {
  if (order == null) return <span className="lib-grip-gap" />;
  return (
    <button className="lib-grip" data-grip={id} tabIndex={-1} aria-hidden="true" title={L`Перетащи, чтобы изменить порядок загрузки`}>
      <span className="ms">drag_indicator</span>
    </button>
  );
}
