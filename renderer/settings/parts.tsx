/* The pieces every part of Settings is made of: a section with its heading, a row, and the list of
 * sections down the left that keeps the one on screen lit.
 *
 * A row is one setting: what it is on the left (a name, a line under it, and the long explanation
 * folded under "Read more"), its control on the right. Every switch on the page sits in that one
 * right-hand column, where before they stood wherever their label happened to end. A wide row puts
 * its control under the text instead: a path, a proxy field, a list. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

export interface SectionDef { id: string; icon: string; title: string }

export function Section({ def, i, children }: { def: SectionDef; i: number; children: ReactNode }) {
  return (
    <section className="settings-block set-section" id={`set-${def.id}`} data-section={def.id}
      style={{ '--i': i } as CSSProperties} aria-labelledby={`set-${def.id}-title`}>
      <h2 className="set-title" id={`set-${def.id}-title`}><span className="ms" aria-hidden="true">{def.icon}</span>{def.title}</h2>
      {children}
    </section>
  );
}

interface RowProps {
  label?: ReactNode;
  /** one or two lines, always shown */
  hint?: ReactNode;
  /** the whole explanation, folded until asked for */
  more?: ReactNode;
  /** the control goes under the text, across the row */
  wide?: boolean;
  /** one of several switches under a row that names them */
  sub?: boolean;
  id?: string;
  children?: ReactNode;
}

export function Row({ label, hint, more, wide, sub, id, children }: RowProps) {
  const folded = more && (
    <details className="set-more">
      <summary>{L`Подробнее`}</summary>
      <div className="settings-hint">{more}</div>
    </details>
  );
  const control = children !== undefined && children !== null && children !== false && <div className="set-ctl">{children}</div>;
  return (
    <div className={`set-row${wide ? ' wide' : ''}${sub ? ' sub' : ''}`} id={id}>
      <div className="set-text">
        {label && <div className="set-label">{label}</div>}
        {hint && <div className="settings-hint">{hint}</div>}
        {!wide && folded}
      </div>
      {control}
      {/* under a path or a field, the explanation comes after what it explains */}
      {wide && folded}
    </div>
  );
}

/** The sections down the left: a click scrolls to one, and the one being read is lit. */
export function SectionNav({ sections }: { sections: SectionDef[] }) {
  const [active, setActive] = useState(sections[0]?.id || '');
  useEffect(() => {
    // the section being read: the last one whose heading has gone up past the top quarter of the
    // window. Watching what is on screen lit the one above while the next filled the view.
    const pick = (e?: Event) => {
      const line = window.innerHeight / 4;
      let current = sections[0]?.id || '';
      for (const s of sections) {
        const el = document.getElementById(`set-${s.id}`);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      // scrolled to the end: the last sections are too short to reach the line, and they are what is shown
      const box = e?.target instanceof HTMLElement ? e.target : null;
      if (box?.querySelector('.set-nav') && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) current = sections[sections.length - 1]?.id || current;
      setActive(current);
    };
    document.addEventListener('scroll', pick, { capture: true, passive: true });
    pick();
    return () => document.removeEventListener('scroll', pick, { capture: true });
  }, [sections]);
  const go = (id: string) => {
    setActive(id);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  };
  return (
    <nav className="set-nav" aria-label={L`Разделы настроек`}>
      {sections.map((s) => (
        <button key={s.id} className={`set-nav-item${active === s.id ? ' active' : ''}`} data-section={s.id}
          aria-current={active === s.id ? 'true' : undefined} onClick={() => go(s.id)}>
          <span className="ms" aria-hidden="true">{s.icon}</span>{s.title}
        </button>
      ))}
    </nav>
  );
}
