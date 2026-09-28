/* Where views/library.ts hands My mods to React. One root for the life of the window: a change on
 * the screen (a switch, a tick, the search) updates the rows on show, and a visit to the screen
 * draws it fresh under a new key, the rows' entrance and all. Drawn synchronously, inside the
 * caller's paint(), so a view transition captures the new screen whole. */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { pane } from '../core/router.js';
import { LibraryScreen } from './LibraryScreen.tsx';
import type { LibraryActions, LibraryModel } from './model.ts';

const root = createRoot(pane('library'));

export function showLibrary(model: LibraryModel, actions: LibraryActions): void {
  flushSync(() => root.render(<LibraryScreen key={model.key} m={model} actions={actions} />));
}
