/* The rows of My mods: a mod (or a cosmetic pick, or a font), a pack that folds open into its
 * members, and a file somebody dropped into the mods folder by hand. Each draws the markup the
 * string templates wrote, so the styles, the simulation and the drag find what they always did. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { plural } from '../ui/format.ts';
import { catalogName, catalogLabel } from '../ui/catalog-name.ts';
import { rowMotion } from './row-motion.ts';
import type { ExternalRowModel, LibraryActions, MemberModel, PackRowModel, RowModel } from './model.ts';
import { CosmeticThumb, Grip, PackThumb, PakFile, Tags, Thumb } from './Thumb.tsx';

interface RowProps { masterOff: boolean; actions: LibraryActions }
/** Bumped by the screen on every redraw but the one after a drop (row-motion.ts). */
interface Moves { motionKey: number }

/* The row's own box, which travels to a new place in the order and folds away when it goes. While
 * it folds it is .leaving: no CSS transition of its own, and nothing spilling out of it. The row
 * moved from its menu is .lifting until it arrives, so it passes over its neighbour rather than
 * through it. */
function RowBox({ className, motionKey, lift, children, ...data }: {
  className: string; motionKey: number; lift: boolean; children: ReactNode; 'data-row': string; 'data-order'?: number; style: CSSProperties;
}) {
  const present = useIsPresent();
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!lift) return undefined;
    setUp(true);
    // the end of the move lowers it; this is for a move that never played (reduced motion, no change)
    const t = setTimeout(() => setUp(false), rowMotion().moveMs + 100);
    return () => clearTimeout(t);
  }, [lift, motionKey]);
  const m = rowMotion();
  const cls = `${className}${up ? ' lifting' : ''}${present ? '' : ' leaving'}`;
  return (
    <motion.div className={cls} layout="position" layoutDependency={motionKey}
      transition={m.transition} exit={m.leave} onLayoutAnimationComplete={() => setUp(false)} {...data}>
      {children}
    </motion.div>
  );
}

const stagger = (i: number) => ({ '--i': Math.min(i, 20) }) as CSSProperties;
const rowClass = (base: string, enabled: boolean, selected: boolean) => `${base} ${enabled ? '' : 'disabled'} ${selected ? 'selected' : ''}`;

export function ModRow({ r, masterOff, actions, motionKey }: RowProps & Moves & { r: RowModel }) {
  const [adopting, setAdopting] = useState(false);
  return (
    <RowBox className={rowClass('lib-row', r.enabled, r.selected)} motionKey={motionKey} lift={r.lift} data-row={r.id} data-order={r.order ?? undefined} style={stagger(r.index)}>
      <Grip id={r.id} order={r.order} />
      {r.selectable
        ? <input type="checkbox" className="lib-check" data-check={r.id} checked={r.selected} aria-label={L`Выбрать мод`}
          onChange={(e) => actions.select(r.id, e.target.checked)} />
        : <span className="lib-check-gap" />}
      {r.cosmetic ? <CosmeticThumb name={r.cosmetic.name} icon={r.cosmetic.icon} /> : <Thumb thumb={r.thumb} cls="lib-thumb" />}
      <div className="lib-info">
        <div className="lib-name">
          <span title={r.cosmetic?.name || r.name}>{catalogName(r.name)}</span>
          {r.styleLabel && <>{' '}<span className="lib-style-label" title={r.styleLabel}>({catalogLabel(r.styleLabel)})</span></>}
          <Tags tags={r.tags} />
        </div>
        <div className="lib-meta"><span>{r.meta}</span>{r.pakFile && <PakFile name={r.pakFile} />}</div>
      </div>
      <div className="lib-actions">
        {r.toggle
          ? <button className={`toggle ${r.enabled ? 'on' : ''}`} data-id={r.id} role="switch" aria-checked={r.enabled} aria-label={L`Включить/выключить`}
            title={r.toggle.title ?? undefined} disabled={masterOff} onClick={() => actions.toggle(r.id)} />
          : <span className="text-meta">{L`всегда активен`}</span>}
        {r.adoptable && (
          <button className="btn btn-sm btn-primary" data-adopt={r.id} title={L`Привязать к каталогу`} disabled={adopting}
            onClick={() => { setAdopting(true); actions.adopt(r.id).finally(() => setAdopting(false)); }}>
            <span className="ms">library_add_check</span>{L`Привязать`}
          </button>
        )}
        <button className="btn btn-sm btn-danger" data-del={r.id} onClick={() => actions.remove(r.id)}>{L`Удалить`}</button>
      </div>
    </RowBox>
  );
}

export function PackRow({ p, masterOff, actions, motionKey }: RowProps & Moves & { p: PackRowModel }) {
  const n = p.members.length;
  return (
    <>
      <RowBox className={rowClass('lib-row pack-row', p.enabled, p.selected)} motionKey={motionKey} lift={p.lift} data-row={p.id} data-order={p.order ?? undefined} style={stagger(p.index)}>
        <Grip id={p.id} order={p.order} />
        <input type="checkbox" className="lib-check" data-check={p.id} checked={p.selected} aria-label={L`Выбрать пак`}
          onChange={(e) => actions.select(p.id, e.target.checked)} />
        <button className={`pack-expand ${p.open ? 'open' : ''}`} data-expand={p.id} aria-expanded={p.open} aria-label={L`Развернуть состав пака`}
          onClick={() => actions.expand(p.id)}>
          <span className="ms">chevron_right</span>
        </button>
        <PackThumb p={p} />
        <div className="lib-info">
          <div className="lib-name">{p.name}{' '}<span className="lib-tag pack">{L`Пак · ${n} ${plural(n, 'мод', 'мода', 'модов')}`}</span></div>
          <div className="lib-meta"><span>{L`${p.onCount} из ${n} включено`}</span>{p.pakFile && <PakFile name={p.pakFile} />}</div>
        </div>
        <div className="lib-actions">
          <button className={`toggle ${p.enabled ? 'on' : ''}`} data-id={p.id} role="switch" aria-checked={p.enabled} aria-label={L`Включить/выключить пак целиком`}
            disabled={masterOff} onClick={() => actions.toggle(p.id)} />
          <button className="btn btn-sm btn-danger" data-del={p.id} onClick={() => actions.remove(p.id)}>{L`Удалить`}</button>
        </div>
      </RowBox>
      {/* rendered only while open, so a closed pack has nothing under it for the drag to carry */}
      <AnimatePresence initial={false}>
        {p.open && (
          <motion.div key="fold" className="pack-fold" layout="position" layoutDependency={motionKey} transition={rowMotion().transition}
            initial={rowMotion().fold} animate={rowMotion().unfold} exit={rowMotion().fold}>
            <div className="pack-members open" data-members={p.id}>
              {p.members.map((m) => <MemberRow key={m.key} packId={p.id} m={m} masterOff={masterOff} actions={actions} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function MemberRow({ packId, m, masterOff, actions }: RowProps & { packId: string; m: MemberModel }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={rowClass('member-row', m.enabled, m.selected)}>
      <input type="checkbox" className="lib-check" data-check={m.key} checked={m.selected} aria-label={L`Выбрать мод в паке`}
        onChange={(e) => actions.select(m.key, e.target.checked)} />
      <Thumb thumb={m.thumb} cls="member-thumb" />
      <div className="member-info">
        <div className="member-name" title={m.name}>{catalogName(m.name)}{m.styleLabel && <>{' '}<span className="lib-style-label" title={m.styleLabel}>({catalogLabel(m.styleLabel)})</span></>}</div>
        <div className="member-meta">{m.meta}</div>
      </div>
      <div className="member-actions">
        <button className={`toggle sm ${m.enabled ? 'on' : ''}`} data-mtoggle={m.id} data-pack={packId} role="switch" aria-checked={m.enabled}
          aria-label={L`Включить/выключить мод в паке`} disabled={masterOff || busy}
          onClick={() => { setBusy(true); actions.toggleMember(packId, m.id).finally(() => setBusy(false)); }} />
        <button className="member-x" data-mremove={m.id} data-pack={packId} aria-label={L`Удалить из пака`} title={L`Удалить из пака`}
          onClick={() => actions.removeMember(packId, m.id)}>
          <span className="ms">close</span>
        </button>
      </div>
    </div>
  );
}

/* A foreign file: "Принять" takes it in, with a preview, a switch and everything else. A cursor or
 * font set is a whole folder rather than one file, so it is only ever adopted. */
export function ExternalRow({ f, actions }: { f: ExternalRowModel; actions: LibraryActions }) {
  const [busy, setBusy] = useState(false);
  const adopt = () => { setBusy(true); actions.external('adopt', f.key).finally(() => setBusy(false)); };
  return (
    <div className={`lib-row ${f.enabled ? '' : 'disabled'} ${f.dup ? 'dup' : ''}`}>
      <Thumb thumb={f.thumb} cls="lib-thumb" />
      <div className="lib-info">
        <div className="lib-name">{f.name}<Tags tags={f.tags} /></div>
        <div className="lib-meta">{f.fileName && <span>{f.fileName}</span>}{f.size && <span>{f.size}</span>}<span>{f.sub}</span></div>
      </div>
      <div className="lib-actions">
        {!f.simple && <button className={`toggle ${f.enabled ? 'on' : ''}`} data-ext={f.key} role="switch" aria-checked={f.enabled}
          onClick={() => actions.external('toggle', f.key)} />}
        {f.adopt && (
          <button className="btn btn-sm btn-primary" data-adopt={f.key} title={f.adopt.title} disabled={busy} onClick={adopt}>
            <span className="ms">library_add_check</span>{L`Принять`}
          </button>
        )}
        {f.splittable && (
          <button className="btn btn-sm" data-extsplit={f.key} title={L`Разбить на отдельные моды по героям`}
            onClick={() => actions.external('split', f.key)}>
            <span className="ms">call_split</span>{L`Разобрать`}
          </button>
        )}
        {!f.simple && <button className="btn btn-sm btn-danger" data-extdel={f.key} onClick={() => actions.external('remove', f.key)}>{L`Удалить`}</button>}
      </div>
    </div>
  );
}
