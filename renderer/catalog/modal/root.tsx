/* Where views/catalog.js hands a window to React: a mod's (ModModal.tsx) or a free look's
 * (cosmetic/CosmeticModal.tsx). Drawn synchronously, so the window is laid out by the time the
 * overlay shows and modal-motion.ts measures it to grow it out of the card. */
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ModModal } from './ModModal.tsx';
import type { ModModalActions, ModModalModel } from './model.ts';
import { CosmeticModal, type CosmeticModalActions, type CosmeticModalModel } from '../cosmetic/CosmeticModal.tsx';
import { reactModalLayer, whenReactModalLeaves } from './layers.ts';

const root = createRoot(reactModalLayer());

function show(node: ReactNode): void {
  reactModalLayer();
  flushSync(() => root.render(node));
}

export const showModModal = (model: ModModalModel, actions: ModModalActions): void => show(<ModModal m={model} actions={actions} />);
export const showCosmeticModal = (model: CosmeticModalModel, actions: CosmeticModalActions): void =>
  show(<CosmeticModal m={model} actions={actions} />);

whenReactModalLeaves(() => flushSync(() => root.render(null)));
