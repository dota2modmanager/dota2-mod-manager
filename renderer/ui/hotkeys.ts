/* Keys for the things done every session.
 *
 * The rare actions went to the right mouse button (see ui/menu.ts); this is the other half:
 * moving between the sections, getting to the search box, and refreshing the catalog.
 * Nothing here deletes or installs anything - a keyboard is easy to hit by accident, and the
 * app writes into somebody's game files.
 *
 * A shortcut is ignored while a dialog, a mod window, the install list or the first-launch
 * language picker is open: those own the keyboard until they close, and a section change
 * underneath one would leave the user looking at a window belonging to a screen they left.
 * Escape is not handled here at all - each of those closes itself.
 */
import { $ } from '../core/dom.ts';

// in the title bar's order, Settings last (3.0 added Items and the Workshop)
const SECTIONS = ['catalog', 'items', 'studio', 'library', 'presets', 'settings'];

// .confirm-overlay covers the confirm, the prompt, the share sheet and the what's-new notes
const overlayOpen = (): boolean => !!document.querySelector('.confirm-overlay, .lang-pick-overlay')
  || !$('#modalOverlay').classList.contains('hidden')
  || !$('#queueOverlay').classList.contains('hidden');

/** The actions are passed in rather than imported: this module lives under ui/ and the screens live above it. */
export function bindHotkeys({ onSection, onRefresh, onBack, onForward }: {
  onSection: (view: string) => void; onRefresh: () => void; onBack: () => void; onForward: () => void;
}): void {
  const search = $<HTMLInputElement>('#globalSearch');

  /* Back closes what is open on top first, the way it does on a phone: with a mod window up, the
   * section behind it is not where the user thinks they are. Each of those closes on Escape. */
  const back = () => {
    if (overlayOpen()) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else onBack();
  };
  const forward = () => { if (!overlayOpen()) onForward(); };

  // the side buttons are 3 (back) and 4 (forward); Chromium would otherwise walk the page's own history
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.button === 3) back(); else forward();
  });

  document.addEventListener('keydown', (e) => {
    // Escape in the search box empties it. The field is the one place where the key has
    // nothing else to close, and a query left behind is why the catalog "shows nothing".
    if (e.key === 'Escape' && document.activeElement === search) {
      if (search.value) {
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        search.blur();
      }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') back(); else forward();
      return;
    }
    if (overlayOpen()) return;

    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key >= '1' && e.key <= '6') {
      e.preventDefault();
      onSection(SECTIONS[Number(e.key) - 1]);
      return;
    }
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      search.focus();
      search.select();
      return;
    }
    // F5 would reload the window, which throws away the loaded catalog to show the same
    // thing again. It means "fetch it again" here, which is what the user wanted anyway.
    if (e.key === 'F5') {
      e.preventDefault();
      onRefresh();
    }
  });
}
