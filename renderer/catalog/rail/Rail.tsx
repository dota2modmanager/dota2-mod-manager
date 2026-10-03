/* The category rail down the left: everything, the favourites, then the catalog's sections and the
 * free cosmetics. views/catalog.ts works out what is in it; this draws it, in the element the
 * window already has for it (#catRail). */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MotionConfig, motion } from 'motion/react';
import { dur, ease } from '../../motion/tokens.ts';

interface RailItem {
  id: string;
  icon: string;
  name: string;
  /** how many are starred, beside the favourites */
  count?: number;
  /** something picked in this cosmetic slot */
  dot?: boolean;
  fav?: boolean;
}

export interface RailModel {
  active: string;
  sections: { label: string | null; items: RailItem[] }[];
}

function Rail({ model, pick }: { model: RailModel; pick: (id: string) => void }) {
  return (
    <>
      {model.sections.map((s, si) => (
        <RailSection key={s.label ?? `top:${si}`} label={s.label} items={s.items} active={model.active} pick={pick} />
      ))}
    </>
  );
}

function RailSection({ label, items, active, pick }: { label: string | null; items: RailItem[]; active: string; pick: (id: string) => void }) {
  return (
    <>
      {label && <div className="rail-section">{label}</div>}
      {items.map((it) => (
        <button key={it.id} className={`rail-item ${it.fav ? 'fav ' : ''}${active === it.id ? 'active' : ''}`}
          data-cat={it.id} onClick={() => pick(it.id)}>
          {/* one highlight for the whole rail: it travels to the category picked, so the eye
              follows the move instead of seeing one pill go out and another come on */}
          {active === it.id && <motion.span layoutId="rail-active" className="rail-active" transition={slide()} />}
          <span className="ms">{it.icon}</span>{it.name}
          {it.count ? <span className="rail-cnt">{it.count}</span> : null}
          {it.dot && <span className="rail-dot" />}
        </button>
      ))}
    </>
  );
}

const slide = () => ({ duration: dur('--dur-medium'), ease: ease('--ease-standard') });

let root: ReturnType<typeof createRoot> | null = null;

export function renderRail(el: HTMLElement, model: RailModel, pick: (id: string) => void): void {
  if (!root) {
    el.replaceChildren();
    root = createRoot(el);
  }
  const r = root;
  flushSync(() => r.render(<MotionConfig reducedMotion="user"><Rail model={model} pick={pick} /></MotionConfig>));
}
