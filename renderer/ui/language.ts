/* Switching the app's own language, and asking for it once on the first run.
 *
 * Two halves: the markup in index.html carries data-i18n keys and is translated in place,
 * while everything drawn from JavaScript simply redraws. The chrome has to be repainted by
 * hand either way - a grip's label and a tab's width both depend on the words in them.
 *
 * The language of this app has nothing to do with Dota's own, nor with which mods folder is
 * used: that follows the game's audio language (see src/gamelang.ts).
 */
import { state } from '../core/store.ts';
import { render } from '../core/router.ts';
import { refreshCosmeticSlots } from '../core/installed.ts';
import { paintMasterSwitch, paintSafeModeSwitch, refreshSidebarStatus } from './statusbar.ts';
import { paintPanels, syncNavOverflow } from './chrome.ts';

// translate the static app chrome (index.html markup) in place, preserving child nodes
export function applyStaticI18n(): void {
  document.documentElement.lang = window.I18N_LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const txt = tr(el.getAttribute('data-i18n') || '');
    if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = txt;
    else el.insertBefore(document.createTextNode(txt), el.firstChild);
  });
  const attr = (from: string, to: string) => document.querySelectorAll(`[${from}]`)
    .forEach((el) => el.setAttribute(to, tr(el.getAttribute(from) || '')));
  attr('data-i18n-ph', 'placeholder');
  attr('data-i18n-title', 'title');
  attr('data-i18n-aria', 'aria-label');
  if (state.panels) paintPanels(); // grip labels depend on whether the panel is folded
  syncNavOverflow();               // translated tab labels change how much room they need
}

// switch the app's own UI language. It used to also pick the Dota folder (English -> dota_123),
// which is exactly what broke when Dota stopped mounting made-up folders — the folder now
// follows the game's audio language and has nothing to do with the language of this app.
export async function applyLanguage(want: unknown): Promise<void> {
  const lang = want === 'ru' || want === 'zh-CN' ? want : 'en';
  window.I18N_LANG = lang;
  try { localStorage.setItem('uiLang', lang); } catch { /* ignore */ }
  await window.api.settings.set('uiLang', lang);
  // Slot labels and set-piece explanations come from the main process, not renderer i18n.
  // Startup has already cached them before the first-run picker is shown.
  await refreshCosmeticSlots();
  applyStaticI18n();
  // Both status bar switches say on or off in words, and the title bar has a sign-in button:
  // painted once at start, so an English switch left "вкл" and "Войти" on screen until the
  // next restart (found by the simulation's settings scenario, tools/sim, 2026-09-24). The
  // button is drawn by app.js, which this module cannot import, so it is told by an event.
  paintMasterSwitch();
  paintSafeModeSwitch();
  document.dispatchEvent(new CustomEvent('mm:language', { detail: lang }));
  await refreshSidebarStatus();
  render();
}

// one-time chooser shown on first launch and once after this release ships. English is the
// default. Resolves once the user picks (the choice is applied by applyLanguage).
export function showLanguagePicker(): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'lang-pick-overlay';
    overlay.innerHTML = `
      <div class="lang-pick-box">
        <div class="lang-pick-logo">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 4v8l-7 8-7-8V6z"/><path d="M12 8v6"/><path d="M9 11h6"/></svg>
        </div>
        <h2>Choose your language</h2>
        <p>Выберите язык · 可随时在设置中更改 · you can change this anytime in Settings</p>
        <div class="lang-pick-opts">
          <button class="lang-pick-btn" data-lang="en">
            <span class="lp-flag">EN</span>
            <span class="lp-text"><b>English</b><small>App language only</small></span>
            <span class="ms lp-go">chevron_right</span>
          </button>
          <button class="lang-pick-btn" data-lang="ru">
            <span class="lp-flag">RU</span>
            <span class="lp-text"><b>Русский</b><small>Только язык приложения</small></span>
            <span class="ms lp-go">chevron_right</span>
          </button>
          <button class="lang-pick-btn" data-lang="zh-CN">
            <span class="lp-flag">ZH</span>
            <span class="lp-text"><b>简体中文</b><small>仅更改程序界面语言</small></span>
            <span class="ms lp-go">chevron_right</span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    overlay.querySelectorAll<HTMLButtonElement>('.lang-pick-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        overlay.querySelectorAll<HTMLButtonElement>('.lang-pick-btn').forEach((b) => { b.disabled = true; });
        await applyLanguage(btn.dataset.lang);
        await window.api.settings.set('langPromptSeen', true);
        overlay.classList.remove('show');
        setTimeout(() => { overlay.remove(); resolve(); }, 180);
      });
    });
  });
}
