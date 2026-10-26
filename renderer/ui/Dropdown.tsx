/* A custom dropdown select that replaces native OS <select> popups with a floating menu
 * styled after the app's dark theme, with keyboard navigation, scrolling, and smooth chevron animation. */
import { useEffect, useRef, useState } from 'react';
import {
  type DropdownOption,
  findOptionIndex,
  resolveOptions,
  shouldOpenUpward,
  stepIndex,
} from './dropdown-logic.ts';

export type { DropdownOption };

export interface DropdownProps {
  id?: string;
  icon?: string;
  label?: string;
  value: string;
  options: DropdownOption[];
  first?: string;
  onPick: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function Dropdown({
  id,
  icon,
  label,
  value,
  options,
  first,
  onPick,
  disabled = false,
  className = '',
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [upward, setUpward] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allOptions = resolveOptions(options, first);
  const selectedIndex = findOptionIndex(allOptions, value);
  const current = selectedIndex >= 0 ? allOptions[selectedIndex] : allOptions[0];
  const currentLabel = current ? current.label : (first ?? value);

  const toggle = () => {
    if (disabled) return;
    if (!open && triggerRef.current) {
      setUpward(shouldOpenUpward(triggerRef.current.getBoundingClientRect(), window.innerHeight));
      setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
    setOpen((prev) => !prev);
  };

  const pick = (val: string) => {
    onPick(val);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }

    // closed, the arrows step through the values as a native select's do; Alt+Down opens it, as there
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = stepIndex(selectedIndex, allOptions.length, 1, false);
        if (next >= 0 && next !== selectedIndex) onPick(allOptions[next].value);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = stepIndex(selectedIndex, allOptions.length, -1, false);
        if (prev >= 0 && prev !== selectedIndex) onPick(allOptions[prev].value);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        if (allOptions.length) onPick(allOptions[0].value);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        if (allOptions.length) onPick(allOptions[allOptions.length - 1].value);
        return;
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => stepIndex(prev, allOptions.length, 1, true));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => stepIndex(prev, allOptions.length, -1, true));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlightIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlightIndex(allOptions.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < allOptions.length) {
        pick(allOptions[highlightIndex].value);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (open && listRef.current && highlightIndex >= 0) {
      const itemEl = listRef.current.children[highlightIndex] as HTMLElement | undefined;
      itemEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      if (listRef.current && listRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onBlur = () => setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={`select-wrap custom-select-wrap ${open ? 'open' : ''} ${className}`}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        value={value}
        className={`custom-select-trigger ${open ? 'open' : ''}`}
        // the name holds the shown value too: a voice user says what they see (WCAG 2.5.3)
        aria-label={label ? `${label}: ${currentLabel}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        {icon && <span className="ms custom-select-icon" aria-hidden="true">{icon}</span>}
        <span className="custom-select-label">{currentLabel}</span>
        <span className="ms custom-select-arrow" aria-hidden="true">expand_more</span>
      </button>

      {open && (
        <div
          ref={listRef}
          className={`custom-select-menu ${upward ? 'upward' : ''}`}
          role="listbox"
          aria-label={label}
        >
          {allOptions.map((opt, i) => {
            const isSelected = opt.value === value;
            const isHighlighted = i === highlightIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`custom-select-option ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                tabIndex={-1}
                // keeps the focus on the trigger; the pick itself is the click's, once
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pick(opt.value);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
              >
                {opt.icon && <span className="ms option-icon" aria-hidden="true">{opt.icon}</span>}
                <span className="option-label">{opt.label}</span>
                {isSelected && <span className="ms option-check" aria-hidden="true">check</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { Dropdown as Select };
