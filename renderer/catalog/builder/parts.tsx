/* What every item builder window shares: a look's picture, the header with its way back, the bar
 * along the bottom, and what an empty search says. */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { watchIconFor } from '../../ui/cosmetic-icons.ts';
import { useCosmeticIcon } from '../cosmetic/CosmeticCard.tsx';
import type { BuilderAction } from './model.ts';

/** A look's picture out of the game's own files, fetched once it is near the screen. */
export function CosThumb({ name, fallback, cls = 'card-thumb' }: { name: string | null; fallback: string; cls?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const icon = useCosmeticIcon(name || '');
  useEffect(() => (name && ref.current ? watchIconFor(ref.current, name) : undefined), [name]);
  const shown = name ? icon : null;
  return (
    <span className={cls} data-name={name || undefined} data-owned={name ? 'react' : undefined} ref={ref}>
      {shown ? <img src={shown} alt="" loading="lazy" /> : <div className="noimg"><span className="ms">{fallback || 'checkroom'}</span></div>}
    </span>
  );
}

/** The header of every builder window: the way back, the title, what it is, the close button. */
export function BuilderHead({ back, onBack, title, sub, onClose }: {
  back: string | null; onBack: () => void; title: string; sub: ReactNode; onClose: () => void;
}) {
  return (
    <div className="modal-title-row item-picker-head">
      <div>
        {back && (
          <button className="btn btn-sm btn-ghost item-back" id="itemBackBtn" onClick={onBack}>
            <span className="ms">arrow_back</span>{back}
          </button>
        )}
        <div className="modal-title">{title}</div>
        <div className="modal-sub">{sub}</div>
      </div>
      <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={onClose}><span className="ms">close</span></button>
    </div>
  );
}

/** What goes along the window's bottom: what it will put on, and the one button that does it. */
export function BuilderFoot({ summary, action, onApply }: { summary: ReactNode; action: BuilderAction; onApply: () => void }) {
  return (
    <>
      <div className="item-picker-sum">{summary}</div>
      <button className="btn btn-primary" id="itemApplyBtn" disabled={action.off} onClick={onApply}>
        <span className="ms">{action.icon}</span>{action.label}
      </button>
    </>
  );
}

/* What a builder window shows when its search leaves nothing. The catalog's "clear the filters"
 * pointed at controls these windows do not have: the search is the only thing narrowing them. */
export function EmptySearch({ onClear }: { onClear: () => void }) {
  return (
    <div className="empty-note item-empty">
      {L`Ничего не найдено. Очисти поиск`}{' '}
      <button className="btn btn-sm" data-clear-search onClick={onClear}>{L`Очистить`}</button>
    </div>
  );
}

/** The search at the top of a picker; clearing it from the empty grid puts the cursor back in it. */
export function PickerSearch({ id, value, onChange, inputRef }: {
  id: string; value: string; onChange: (v: string) => void; inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="tb-search item-picker-search">
      <span className="ms">search</span>
      <input type="text" id={id} ref={inputRef} placeholder={L`Поиск…`} value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
