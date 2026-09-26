/* Mods the catalog tags adult (18+), and the one question about them.
 *
 * In September 2026 that is five of 1138: explicit models of five heroes. They are hidden from
 * the catalog, the search and the home screen until the user says they are 18 and wants them,
 * asked once, after the language on the first run (and on the first run after the update that
 * brought this). The answer lives in settings.showAdult and Settings can change it. A catalog
 * with no adult mod asks nothing.
 *
 * Only browsing is filtered. The mod index stays whole: an adult mod somebody already installed
 * keeps its name and picture in My mods, and hiding it from the catalog does not remove it.
 *
 * No router here: this is imported by a test, and whoever changes the answer redraws.
 */
import { state } from './store.js';
import { plural } from '../ui/format.js';

/** Whether the catalog tags a mod adult. */
export const isAdult = (m) => Boolean(m && m.tags && m.tags.adult);

/** Whether the user said they are 18 and want adult mods shown. Unanswered is no. */
export const adultShown = () => state.settings?.showAdult === true;

/** The mods somebody browsing the catalog is shown. */
export const shownMods = (mods) => (adultShown() ? mods : mods.filter((m) => !isAdult(m)));

/** How many adult mods the loaded catalog has, counted in the whole mod index. */
export function adultCount() {
  let n = 0;
  for (const hit of state.modIndex.values()) if (isAdult(hit.mod)) n++;
  return n;
}

/** Whether the question still needs asking: never answered, and something to ask about. */
export const adultUnanswered = () => typeof state.settings?.showAdult !== 'boolean' && adultCount() > 0;

/** "5 mods", in the language of the window. */
const modsWord = (n) => `${n} ${plural(n, 'мод', 'мода', 'модов')}`;

/** The line under the switch in Settings. */
export function adultHint() {
  const n = adultCount();
  return n
    ? L`${modsWord(n)} с откровенными моделями героев. Включая, ты подтверждаешь, что тебе есть 18 лет.`
    : L`Включая, ты подтверждаешь, что тебе есть 18 лет.`;
}

/* The question, in the shape of the other one-time question the app asks on a first run (the
 * Source 2 Viewer offer): what it is about, how many, what stays as it is, and two answers. Not
 * showing is the answer that holds focus, so a stray Enter keeps them hidden. Escape and a click
 * outside answer nothing: they stay hidden and the question comes back on the next start.
 *
 * Resolves true to show them, false not to, null when the window was closed without an answer. */
export function adultDialog(count) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box tool-box" role="dialog" aria-modal="true" aria-labelledby="adultDlgTitle">
        <div class="tool-head">
          <span class="ms">18_up_rating</span>
          <div>
            <div class="tool-title" id="adultDlgTitle">${L`Показывать моды 18+?`}</div>
            <div class="tool-sub">${L`Спрашиваем один раз, ответ можно поменять в настройках`}</div>
          </div>
        </div>
        <p class="tool-lede">${L`В каталоге ${modsWord(count)} для взрослых: откровенные модели героев. Пока ты не ответишь, их не видно ни в каталоге, ни в поиске.`}</p>
        <p class="tool-cost">${L`Уже установленные моды это не трогает.`}</p>
        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Не показывать`}</button>
          <button class="btn btn-primary" data-c="yes">${L`Мне есть 18, показывать`}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    overlay.querySelector('[data-c="no"]').addEventListener('click', () => done(false));
    overlay.querySelector('[data-c="yes"]').addEventListener('click', () => done(true));
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-c="no"]').focus();
  });
}

/** Save an answer. The caller redraws whatever is on screen. */
export async function setAdultShown(on) {
  state.settings = await window.api.settings.set('showAdult', on === true);
}

/**
 * Asked once, when there is something to ask about. Resolves true when the answer changed what
 * the catalog shows, so the caller knows to redraw.
 */
export async function askAdultOnce() {
  if (!adultUnanswered()) return false;
  const answer = await adultDialog(adultCount());
  if (answer === null) return false;
  await setAdultShown(answer);
  return answer;
}
