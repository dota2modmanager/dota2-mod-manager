/* A piece of the screen still written as markup, standing inside a React one: the free cosmetics
 * in the favourites and the search. React owns the element and never its children; the markup is
 * written and bound again whenever it changes. */
import { useLayoutEffect, useRef } from 'react';

interface Props {
  html: string;
  bind?: (el: HTMLElement) => void;
  className?: string;
  id?: string;
}

export function LegacyHtml({ html, bind, className, id }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    bind?.(el);
  }, [html, bind]);
  return <div ref={ref} className={className} id={id} />;
}
