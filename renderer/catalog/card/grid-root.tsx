/* Where the catalog screen hands a list to React.
 *
 * The screen still writes its frame as markup (headings, the toolbar, an empty <div class="grid">)
 * and calls renderGrid() on the grid inside the same paint(), so a view transition captures the
 * cards as part of the new screen. A grid whose element the next screen threw away is unmounted
 * the next time any grid is drawn, rather than left holding a tree nobody can see. */
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ModGrid, type GridProps } from './ModGrid.tsx';

const grids = new Map<Element, { root: Root; props: GridProps }>();

function sweep(): void {
  for (const [el, g] of grids) {
    if (!el.isConnected) { g.root.unmount(); grids.delete(el); }
  }
}

export function renderGrid(container: Element | null, props: GridProps): void {
  sweep();
  if (!container) return;
  let g = grids.get(container);
  if (!g) {
    g = { root: createRoot(container), props };
    grids.set(container, g);
  }
  g.props = props;
  const { root } = g;
  flushSync(() => root.render(<ModGrid {...props} />));
}

/** Every grid on screen draws again with what it was last given: installs changed a badge. */
export function refreshGrids(): void {
  sweep();
  for (const g of grids.values()) {
    const { root, props } = g;
    flushSync(() => root.render(<ModGrid {...props} />));
  }
}
