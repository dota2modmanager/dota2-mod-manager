/* Where the catalog hands a window to React: a mod's (ModModal.tsx), a free look's
 * (cosmetic/CosmeticModal.tsx), the arcana's (arcana/ArcanaModal.tsx) or one of the item
 * builder's (builder/). Drawn synchronously, so
 * the window is laid out by the time the overlay shows and modal-motion.ts measures it to grow it
 * out of the card. A builder window carries the number of the time it was opened: the same number
 * updates the window on show, a new one draws it fresh, entrances and all. */
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ModModal } from './ModModal.tsx';
import type { ModModalActions, ModModalModel } from './model.ts';
import { CosmeticModal, type CosmeticModalActions, type CosmeticModalModel } from '../cosmetic/CosmeticModal.tsx';
import { ArcanaModal, type ArcanaModalActions, type ArcanaModalModel } from '../arcana/ArcanaModal.tsx';
import { SlotPicker } from '../builder/SlotPicker.tsx';
import { HeroModal } from '../builder/HeroModal.tsx';
import { SetModal, SetsModal } from '../builder/SetsModal.tsx';
import type * as B from '../builder/model.ts';

const panel = document.getElementById('modalContent') as HTMLElement;
const layer = document.createElement('div');
layer.id = 'modalReact';
layer.className = 'modal-layer';
panel.append(layer);
const root = createRoot(layer);

function show(node: ReactNode): void {
  flushSync(() => root.render(node));
}

/** The window has closed: draw nothing until the next one. */
export const clearModal = (): void => show(null);

export const showModModal = (model: ModModalModel, actions: ModModalActions): void => show(<ModModal m={model} actions={actions} />);
export const showCosmeticModal = (model: CosmeticModalModel, actions: CosmeticModalActions): void =>
  show(<CosmeticModal m={model} actions={actions} />);
export const showArcanaModal = (model: ArcanaModalModel, actions: ArcanaModalActions): void =>
  show(<ArcanaModal m={model} actions={actions} />);

export const showSlotPicker = (key: number, m: B.SlotPickerModel, actions: B.SlotPickerActions): void =>
  show(<SlotPicker key={key} m={m} actions={actions} />);
export const showHeroModal = (key: number, m: B.HeroModalModel, actions: B.HeroModalActions): void =>
  show(<HeroModal key={key} m={m} actions={actions} />);
export const showSetsModal = (key: number, m: B.SetsModalModel, actions: B.SetsModalActions): void =>
  show(<SetsModal key={key} m={m} actions={actions} />);
export const showSetModal = (key: number, m: B.SetModalModel, actions: B.SetModalActions): void =>
  show(<SetModal key={key} m={m} actions={actions} />);
