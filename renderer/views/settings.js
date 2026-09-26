/* Settings: everything the app itself remembers.
 *
 * The page is mostly other modules' knobs - the scale belongs to ui/chrome.js, the language
 * to ui/language.js - because a setting is a thing the whole window obeys, not a thing this
 * screen owns. What is genuinely here is the wiring: which control writes which value, and
 * what has to be repainted once it does.
 *
 * What is deliberately not here: anything about Dota's own languages or the folder mods go
 * into. The folder follows the game's audio language and the app arranges that itself
 * (see keepModFolder in main.js). Dota's text language is the user's, chosen when they
 * installed the game, and no mod depends on it. Where mods
 * can go missing is news, not a setting, so it is a banner on the Library.
 *
 * The one import from another screen is loadCatalog, for the button that re-fetches the
 * catalog. It asks the catalog for its data, not for a drawing, so the router is not what
 * that call wants.
 */
import { $ } from '../core/dom.js';
import { state } from '../core/store.js';
import { registerView, pane, invalidateViews } from '../core/router.js';
import { esc, fmtMB } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { showWhatsNew } from '../ui/dialog.js';
import { refreshSidebarStatus } from '../ui/statusbar.js';
import { clampScale, currentScalePct, paintScale, applyScalePct, clampPanelZoom, paintPanels, savePanels } from '../ui/chrome.js';
import { applyLanguage } from '../ui/language.js';
import { loadCatalog } from './catalog.js';
import { adultShown, adultHint, setAdultShown } from '../core/adult.js';
import { paint } from '../ui/transitions.js';

const viewRoot = pane('settings');

registerView('settings', () => renderSettings());

export async function renderSettings() {
  const s = await window.api.settings.get();
  state.settings = s;
  const scalePct = Math.round((Number(s.uiScale) || 1) * 100);
  const cacheSize = await window.api.misc.cacheSize();
  const appVersion = await window.api.update.version();
  // the Source 2 toolchain: shown as a size and a button, never downloaded on its own
  let vrf = null;
  try { vrf = (await window.api.tools.state()).tools.find((x) => x.name === 'vrf') || null; } catch { /* older build */ }
  // the beta channel, offered only to an account the signed list names: somebody who is not on it
  // is not told there is a list, because a switch you cannot use is noise
  let beta = { eligible: false, on: false };
  try { beta = await window.api.beta.state(); } catch { /* older build */ }

  await paint(() => { viewRoot.innerHTML = `
    <div class="view-header"><h1 class="view-title">${L`Настройки`}</h1></div>

    <div class="settings-block">
      <h3>${L`Интерфейс`}</h3>
      <div class="settings-row">
        <span class="settings-label">${L`Язык`}</span>
        <div class="select-wrap">
          <span class="ms">translate</span>
          <select class="input" id="uiLangSelect">
            <option value="en" ${s.uiLang === 'en' ? 'selected' : ''}>English</option>
            <option value="ru" ${s.uiLang === 'ru' ? 'selected' : ''}>Русский</option>
          </select>
        </div>
      </div>
      <div class="settings-row spaced">
        <span class="settings-label">${L`Масштаб`}</span>
        <div class="scale-ctl">
          <button class="btn btn-sm scale-step" id="masterDown" aria-label="${L`Мельче`}"><span class="ms">remove</span></button>
          <input type="range" class="scale-range" id="masterRange" min="70" max="160" step="5" value="${scalePct}" aria-label="${L`Масштаб`}">
          <span class="scale-val" id="masterRangeVal">${scalePct}%</span>
          <button class="btn btn-sm scale-step" id="masterUp" aria-label="${L`Крупнее`}"><span class="ms">add</span></button>
          <button class="btn btn-sm" id="masterReset">${L`Сбросить`}</button>
        </div>
      </div>
    </div>

    <div class="settings-block" style="--i:1">
      <h3>Discord</h3>
      <div class="settings-row">
        <span class="settings-label">${L`Показывать в Discord, что ты в Mod Manager`}</span>
        <button class="toggle ${s.discordPresence === false ? '' : 'on'}" id="presenceToggle" role="switch"
                aria-checked="${s.discordPresence !== false}" aria-label="${L`Показывать в Discord, что ты в Mod Manager`}"></button>
      </div>
      <div class="settings-hint">${L`В самом Discord для этого включено «Отображать текущую активность как статус».`}</div>
      ${beta.eligible ? `
      <div class="settings-row spaced">
        <span class="settings-label">${L`Бета-версии`}</span>
        <button class="toggle ${beta.on ? 'on' : ''}" id="betaToggle" role="switch"
                aria-checked="${beta.on}" aria-label="${L`Бета-версии`}"></button>
      </div>
      <div class="settings-hint">${L`Твой аккаунт в списке тестеров: приложение будет обновляться до сборок, которых ещё нет у остальных. Выйдешь из Discord, и оно вернётся на обычные.`}</div>` : ''}
    </div>

    <div class="settings-block" style="--i:2">
      <h3>${L`Путь к Dota 2`}</h3>
      <div class="settings-row">
        <span class="mono grow">${esc(s.dotaGamePath || L`не найден`)}</span>
        <span class="dot ${s.dotaPathValid ? 'ok' : 'bad'}"></span>
      </div>
      <div class="settings-row">
        <button class="btn btn-sm" id="detectBtn">${L`Найти автоматически`}</button>
        <button class="btn btn-sm" id="browseBtn">${L`Указать вручную`}</button>
      </div>
    </div>

    <div class="settings-block" style="--i:3">
      <h3>${L`Кэш загрузок`}</h3>
      <div class="settings-row">
        <span class="settings-label">${L`Размер`}</span>
        <span class="num">${fmtMB(cacheSize)} MB</span>
        <button class="btn btn-sm" id="clearCacheBtn">${L`Очистить`}</button>
      </div>
      <div class="settings-hint">${L`Скачанные архивы, чтобы не качать повторно. Удаление ничего не сломает.`}</div>
    </div>

    ${vrf ? `
    <div class="settings-block" style="--i:4">
      <h3>${L`Картинки из игры и модов`}</h3>
      <div class="settings-row">
        <span class="settings-label">${vrf.ready ? L`Инструмент установлен` : L`Инструмент не скачан`}</span>
        <span class="num">${vrf.ready ? `${fmtMB(vrf.installedBytes)} MB` : `${fmtMB(vrf.downloadBytes)} MB`}</span>
        ${vrf.ready
    ? `<button class="btn btn-sm" id="toolRemoveBtn">${L`Удалить`}</button>`
    : `<button class="btn btn-sm btn-primary" id="toolInstallBtn"><span class="ms">download</span>${L`Скачать`}</button>`}
      </div>
      <div class="settings-hint">${L`Картинки предметов приложение берёт из самой игры: точные, без интернета и без ожидания. А моду, который приехал без превью, находит картинку в его же файлах. Без инструмента предметы грузятся из вики (медленнее и есть не для всего), а моды остаются с заглушкой. Удалить можно в любой момент.`}</div>
    </div>` : ''}

    <div class="settings-block" style="--i:4">
      <h3>${L`Каталог`}</h3>
      <div class="settings-row">
        <span class="settings-label">${L`Обновлён`}</span>
        <span>${state.catalog?.fetchedAt ? new Date(state.catalog.fetchedAt).toLocaleString(window.i18nLocale()) : '—'}</span>
        <button class="btn btn-sm" id="refreshCatBtn2">${L`Обновить сейчас`}</button>
      </div>
      <div class="settings-row">
        <span class="settings-label">${L`Источник`}</span>
        <a class="settings-link" id="srcLink">github.com/h6rd/Dota2PornFxWeb</a>
      </div>
      <div class="settings-row spaced">
        <span class="settings-label">${L`Моды 18+`}</span>
        <button class="toggle ${adultShown() ? 'on' : ''}" id="adultToggle" role="switch"
                aria-checked="${adultShown()}" aria-label="${L`Моды 18+`}"></button>
      </div>
      <div class="settings-hint">${adultHint()}</div>
    </div>

    <div class="settings-block" style="--i:5">
      <h3>${L`Диагностика`}</h3>
      <div class="settings-row spaced">
        <button class="btn btn-sm" id="diagExportBtn"><span class="ms">bug_report</span>${L`Экспортировать отчёт`}</button>
      </div>
      <div class="settings-hint">${L`Путь к игре, список модов и последние записи журнала в одном файле. Пришли его, если что-то не работает.`}</div>
    </div>

    <div class="settings-block" style="--i:6">
      <h3>${L`О программе`}</h3>
      <div class="settings-row">
        <span class="settings-label">${L`Версия`}</span>
        <span class="num">v${esc(appVersion)}</span>
        <a class="settings-link" id="repoLink">github.com/dota2modmanager/dota2-mod-manager</a>
      </div>
      <div class="settings-row">
        <button class="btn btn-sm" id="whatsNewBtn"><span class="ms">auto_awesome</span>${L`Что нового`}</button>
      </div>
      <!-- The people the app owes something to and cannot pay. The catalog is credited in
           its own block above; this row is for whoever else did the work. -->
      <div class="settings-row spaced">
        <span class="settings-label">${L`Спасибо`}</span>
        <span>${L`hanta снял видео о менеджере`}</span>
        <a class="settings-link" id="thanksLink">youtube.com/@hqnta</a>
      </div>
      <!-- Credit NOTICE requires for the item builder (section 7(b)): both names, here. -->
      <div class="settings-row spaced">
        <span class="settings-label">${L`Конструктор предметов`}</span>
        <span>h6rd, TheFleece</span>
        <a class="settings-link" id="builderLink">github.com/h6rd</a>
      </div>
      <div class="settings-hint">© 2026 TheFleece · ${L`конструктор предметов`} © 2026 h6rd, TheFleece · GPL-3.0 · ${L`свободная программа без каких-либо гарантий`}</div>
    </div>
  `; });
  $('#repoLink').addEventListener('click', () => window.api.misc.openExternal('https://github.com/dota2modmanager/dota2-mod-manager'));
  $('#thanksLink').addEventListener('click', () => window.api.misc.openExternal('https://www.youtube.com/@hqnta'));
  $('#builderLink').addEventListener('click', () => window.api.misc.openExternal('https://github.com/h6rd'));
  // 48 MB is a real download, so it says so and waits for the press
  $('#toolInstallBtn')?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    toast(L`Скачиваю инструмент — это разово`, 'ok', 5000);
    const r = await window.api.tools.install('vrf');
    if (r?.error) toast(r.error, 'error', 7000);
    else toast(L`Готово — картинки теперь берутся из игры`);
    renderSettings();
  });
  $('#toolRemoveBtn')?.addEventListener('click', async () => {
    await window.api.tools.remove('vrf');
    toast(L`Инструмент удалён — картинки снова из вики`);
    renderSettings();
  });
  $('#whatsNewBtn').addEventListener('click', () => showWhatsNew({ force: true }));
  $('#diagExportBtn').addEventListener('click', async () => {
    const r = await window.api.diag.export();
    if (r?.cancelled) return;
    if (r?.error) toast(r.error, 'error', 7000);
    else toast(L`Отчёт сохранён`);
  });

  // The app language, and only the app: what somebody reads Dota in was decided when they
  // installed it, and the folder mods go into no longer depends on either (see the file header).
  $('#uiLangSelect').addEventListener('change', async (ev) => {
    const lang = ev.target.value;
    await applyLanguage(lang);
    toast(lang === 'ru' ? L`Язык переключён на Русский` : L`Язык переключён на English`);
    renderSettings();
  });

  // ----- scale -----
  // Scaling the content on every input event fights the drag: the slider moves under the
  // pointer, which feeds the next event. So the number moves while dragging and the window
  // resizes on release. One slider moves the panels with it; each panel still has its own
  // grip to drag and Ctrl + wheel of its own for anyone who wants them apart.
  const setEverything = (pct) => {
    const v = clampScale(pct);
    for (const key of ['topZoom', 'bottomZoom', 'railZoom']) state.panels[key] = clampPanelZoom(v / 100);
    paintPanels();
    savePanels();
    applyScalePct(v);
  };
  $('#masterRange')?.addEventListener('input', (ev) => paintScale(clampScale(Number(ev.target.value))));
  $('#masterRange')?.addEventListener('change', (ev) => setEverything(Number(ev.target.value)));
  $('#masterDown')?.addEventListener('click', () => setEverything(currentScalePct() - 5));
  $('#masterUp')?.addEventListener('click', () => setEverything(currentScalePct() + 5));
  $('#masterReset')?.addEventListener('click', () => setEverything(100));

  $('#detectBtn').addEventListener('click', async () => {
    const found = await window.api.settings.detectDota();
    if (found) toast(L`Dota 2 найдена: ${found}`);
    else toast(L`Не нашёл автоматически — укажи вручную`, 'warn');
    renderSettings();
    refreshSidebarStatus();
  });
  $('#browseBtn').addEventListener('click', async () => {
    const r = await window.api.settings.browseDota();
    if (r?.error) toast(r.error, 'error');
    if (r?.path) toast(L`Путь сохранён`);
    renderSettings();
    refreshSidebarStatus();
  });
  $('#presenceToggle')?.addEventListener('click', async (e) => {
    const on = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.setAttribute('aria-checked', String(on));
    state.settings = await window.api.settings.set('discordPresence', on);
  });
  $('#betaToggle')?.addEventListener('click', async (e) => {
    const on = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.setAttribute('aria-checked', String(on));
    const now = await window.api.beta.set(on);
    toast(now.on ? L`Бета-версии включены` : L`Бета-версии выключены`);
  });
  $('#clearCacheBtn').addEventListener('click', async () => {
    await window.api.misc.clearCache();
    toast(L`Кэш очищен`);
    renderSettings();
  });
  $('#refreshCatBtn2').addEventListener('click', async () => {
    await loadCatalog(true);
    renderSettings();
  });
  // the catalog and the search are drawn again with or without them next time they open
  $('#adultToggle')?.addEventListener('click', async (e) => {
    const on = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.setAttribute('aria-checked', String(on));
    await setAdultShown(on);
    invalidateViews();
  });
  $('#srcLink').addEventListener('click', () => window.api.misc.openExternal('https://github.com/h6rd/Dota2PornFxWeb'));
}
