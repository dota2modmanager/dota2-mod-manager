/* A preset's card. A set of mods is recognised by its pictures and summarised by its categories,
 * so the card leads with a row of covers and a line of counts: forty heroes, three terrains, one
 * cursor. The full list is one click away and grouped, rather than a paragraph of proper nouns in
 * the way of everybody who does not need it. */
import { Fragment, useState, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import { Thumb } from '../library/Thumb.tsx';
import { foldAway, travel } from '../motion/list.ts';
import { Swap } from '../motion/Swap.tsx';
import type { OwnPreset, PresetsActions, SharedPreset } from './model.ts';

/* A card moves like a row of My mods: a card saved above it or deleted beside it makes it travel to
   its new place, and a deleted one folds away (motion/list.ts). Its entrance is cardIn in presets.css. */
const cardMotion = () => ({ layout: 'position' as const, transition: travel(), exit: foldAway('--space-3') });

export function OwnPresetCard({ p, index, actions }: { p: OwnPreset; index: number; actions: PresetsActions }) {
  // applying can download the members that are not installed, which is long enough to press twice
  const [busy, setBusy] = useState(false);
  return (
    <motion.div className="preset-card" style={{ '--i': index } as CSSProperties} {...cardMotion()}>
      <div className="preset-head">
        <div className="preset-name">{p.name}</div>
        <Swap className="text-meta" value={p.count} />
        {p.absent && <span className="text-meta preset-absent" title={p.absent.title}>{p.absent.text}</span>}
        <button className="btn btn-sm btn-primary" data-apply={p.id} disabled={busy}
          onClick={() => { setBusy(true); actions.apply(p.id).finally(() => setBusy(false)); }}>
          {L`Применить`}
        </button>
        <button className="btn btn-sm" data-share={p.id} title={p.linkTitle} onClick={() => actions.share(p.id)}>
          <span className="ms">ios_share</span>{L`Поделиться`}
        </button>
      </div>
      <PresetBody p={p} />
    </motion.div>
  );
}

function PresetBody({ p }: { p: OwnPreset }) {
  const b = p.body;
  if (!b) return <div className="preset-mods">{L`пусто (всё будет выключено)`}</div>;
  return (
    <>
      <div className="preset-strip">
        {b.strip.map((e, i) => ('thumb' in e
          ? <Thumb key={i} thumb={e.thumb} cls="preset-thumb" />
          // named by the build, not installed right now: still part of what the build is
          : <div key={i} className="preset-thumb preset-thumb-absent" title={e.title}><span className="ms">{e.icon}</span></div>))}
        {b.rest > 0 && <div className="preset-more">{`+${b.rest}`}</div>}
      </div>
      <div className="preset-cats">
        {b.cats.map((c) => <span key={c.id} className="preset-cat"><span className="ms">{c.icon}</span>{c.name}<b>{c.n}</b></span>)}
      </div>
      <details className="preset-all">
        <summary><span className="ms">expand_more</span>{L`Что внутри`}</summary>
        {b.groups.map((g) => (
          <div key={g.id} className="preset-group">
            <div className="preset-group-head"><span className="ms">{g.icon}</span>{g.name}<span className="preset-group-n">{g.n}</span></div>
            <div className="preset-group-names">
              {g.names.map((n, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  {n.absent ? <span className="preset-name-absent">{n.name}</span> : n.name}
                </Fragment>
              ))}
            </div>
          </div>
        ))}
      </details>
    </>
  );
}

export function SharedPresetCard({ p, index, actions }: { p: SharedPreset; index: number; actions: PresetsActions }) {
  const [busy, setBusy] = useState(false);
  return (
    <motion.div className="preset-card shared" style={{ '--i': index } as CSSProperties} {...cardMotion()}>
      <div className="preset-head">
        <div className="preset-name">{p.name}</div>
        <span className="lib-tag">{p.tag}</span>
        <span className="text-meta">{p.total}</span>
        <button className="btn btn-sm btn-primary" data-resolve={p.id} disabled={busy}
          onClick={() => { setBusy(true); actions.resolve(p.id).finally(() => setBusy(false)); }}>
          <span className="ms">download</span>{L`Установить`}
        </button>
        {/* a received preset keeps its own delete: the two answers to it are "install" and "no thanks" */}
        <button className="btn btn-sm btn-danger" data-pdel={p.id} onClick={() => actions.remove(p.id)}>{L`Удалить`}</button>
      </div>
      {p.note && <div className="preset-note">{p.note}</div>}
      <div className="preset-mods">{p.mods}</div>
      {p.warn && <div className="preset-warn"><span className="ms">warning</span>{p.warn}</div>}
    </motion.div>
  );
}
