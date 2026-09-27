/* A piece of the screen still written as markup, standing inside a React one: the free cosmetics
 * in the favourites and the search. React owns the element and never its children; the markup is
 * written and bound again whenever it changes. */
import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Props {
  html: string;
  /** a span where the markup sits inside a line of text (the window's credits) */
  tag?: 'div' | 'span';
  bind?: (el: HTMLElement) => void;
  className?: string;
  id?: string;
}

export function LegacyHtml({ html, bind, className, id, tag = 'div' }: Props) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    bind?.(el);
  }, [html, bind]);
  return tag === 'span'
    ? <span ref={ref as RefObject<HTMLSpanElement>} className={className} id={id} />
    : <div ref={ref as RefObject<HTMLDivElement>} className={className} id={id} />;
}
