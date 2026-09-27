/* Where views/catalog.js hands the mod window to React. Drawn synchronously, so the window is laid
 * out by the time the overlay shows and modal-motion.ts measures it to grow it out of the card. */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ModModal } from './ModModal.tsx';
import type { ModModalActions, ModModalModel } from './model.ts';
import { reactModalLayer, whenReactModalLeaves } from './layers.ts';

const root = createRoot(reactModalLayer());

export function showModModal(model: ModModalModel, actions: ModModalActions): void {
  reactModalLayer();
  flushSync(() => root.render(<ModModal m={model} actions={actions} />));
}

whenReactModalLeaves(() => flushSync(() => root.render(null)));
