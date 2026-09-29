/* The three overlays the app owns: what's new after an update, a confirm before anything
 * destructive, and a prompt for a name. All three resolve a promise, close on Escape and on
 * a click outside, and clean up their key listener - a dialog that leaks one of those breaks
 * the next dialog rather than itself, which is why they are together. */
import { esc } from './format.ts';
import { toast } from './toast.ts';
import type { Notice } from '../api/content.ts';

/* Every dialog here is markup this file just wrote, so the parts it wires are there. */
const part = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

// ---------- "what's new" after an update ----------

// The changelog is markdown, but only ever the three shapes this app writes: "### heading",
// "- bullet" and **bold** inside a line. A full parser would be a library for nothing.
function notesHtml(md: string): string {
  const inline = (s: string) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out: string[] = [];
  let list: string[] | null = null;
  const closeList = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (line.startsWith('###')) { closeList(); out.push(`<h4>${inline(line.replace(/^#+\s*/, ''))}</h4>`); continue; }
    if (line.startsWith('- ')) { (list = list || []).push(`<li>${inline(line.slice(2))}</li>`); continue; }
    // a wrapped bullet or paragraph line continues whatever came before it
    if (list) list[list.length - 1] = list[list.length - 1].replace('</li>', ' ' + inline(line) + '</li>');
    else if (out.length && out[out.length - 1].startsWith('<p>')) {
      out[out.length - 1] = out[out.length - 1].replace('</p>', ' ' + inline(line) + '</p>');
    } else out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

/* Anything the app was told from the network since it shipped, above the release notes.
 * A notice is dismissed from its banner and stays here afterwards, which is where somebody
 * goes when they half-remember a message about a Dota patch and want to read it again. */
function noticesHtml(notices: Notice[]): string {
  if (!notices || !notices.length) return '';
  return `
    <div class="notes-notices">
      ${notices.map((n) => `
        <div class="notes-notice ${n.level === 'warn' ? 'warn' : ''}">
          ${n.date ? `<span class="notes-notice-date">${esc(n.date)}</span>` : ''}
          <span>${esc(n.text)}</span>
          ${n.url ? ` <a href="#" class="notice-link" data-url="${esc(n.url)}">${L`Подробнее`}</a>` : ''}
        </div>`).join('')}
    </div>`;
}

function whatsNewDialog(version: string, md: string, notices: Notice[] = []): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box notes-box">
        <div class="notes-head">
          <span class="ms">auto_awesome</span>
          <div>
            <div class="notes-title">${L`Что нового`}</div>
            <div class="notes-ver">${L`версия ${esc(version)}`}</div>
          </div>
        </div>
        <div class="notes-body">${noticesHtml(notices)}${notesHtml(md)}</div>
        <div class="confirm-actions">
          <button class="btn btn-primary" data-c="ok">${L`Понятно`}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = () => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(); });
    part(overlay, '[data-c="ok"]').addEventListener('click', done);
    overlay.querySelectorAll<HTMLElement>('.notice-link').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      window.api.misc.openExternal(a.dataset.url || '');
    }));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(); };
    document.addEventListener('keydown', onKey);
  });
}

// Show it once per version, and only for a version the user did not install by hand.
export async function showWhatsNew({ force = false } = {}): Promise<void> {
  let r: { version: string; notes: string; unseen: boolean } | null = null;
  try { r = await window.api.update.notes(window.I18N_LANG); } catch { return; }
  if (!r || !r.notes) { if (force) toast(L`Для этой версии заметок нет`, 'warn'); return; }
  if (!force && !r.unseen) { window.api.update.notesSeen(); return; }
  let notices: Notice[] = [];
  try { notices = (await window.api.config.state()).notices || []; } catch { /* offline: the release notes alone */ }
  await whatsNewDialog(r.version, r.notes, notices);
  window.api.update.notesSeen();
}

// ---------- custom confirm dialog ----------

export function confirmDialog(message: string, { okLabel = L`Удалить`, danger = true } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg">${esc(message)}</div>
        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Отмена`}</button>
          <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-c="yes">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v: boolean) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    part(overlay, '[data-c="no"]').addEventListener('click', () => done(false));
    part(overlay, '[data-c="yes"]').addEventListener('click', () => done(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    part(overlay, '[data-c="yes"]').focus();
  });
}

// text-input dialog (returns the entered string, or null if cancelled)
export function promptDialog(message: string, { placeholder = '', value = '', okLabel = L`ОК` } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg">${esc(message)}</div>
        <input class="input prompt-input" id="promptInput" placeholder="${esc(placeholder)}" value="${esc(value)}">
        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Отмена`}</button>
          <button class="btn btn-primary" data-c="yes">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = part<HTMLInputElement>(overlay, '#promptInput');
    const done = (v: string | null) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    part(overlay, '[data-c="no"]').addEventListener('click', () => done(null));
    part(overlay, '[data-c="yes"]').addEventListener('click', () => done(input.value.trim() || null));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') done(input.value.trim() || null);
    };
    document.addEventListener('keydown', onKey);
    input.focus();
    input.select();
  });
}

// ---------- turning safe mode off ----------

/* The one switch that lets the app write into the game install, so the question gets asked
 * in full instead of in a line of jargon nobody read: what the app does today, what it will
 * do instead, which two files it edits, and the part nobody can promise. One yes here is a
 * standing one - heal() rewrites those files after every Dota update until safe mode comes
 * back - so the window says that too.
 *
 * Built as a move from one state to the next rather than a comparison - the top card is
 * dimmed, the bottom one is lit, and a short rule runs between them. The two shields are the
 * status bar's own icons for these states, so the dialog also teaches the switch it is about.
 *
 * Resolves true when the user turns it off. Cancel, Escape and a click outside all mean no,
 * and the safe answer is what holds focus.
 */
export function safeModeDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box safe-box" role="dialog" aria-modal="true" aria-labelledby="safeDlgTitle">
        <div class="safe-title" id="safeDlgTitle">${L`Выключить безопасный режим`}</div>
        <div class="safe-body">
          <div class="safe-step from">
            <span class="ms safe-step-icon">shield</span>
            <div class="safe-step-text">
              <span class="safe-eyebrow">${L`Сейчас`}</span>
              <b>${L`Безопасный режим`}</b>
              <p>${L`Приложение кладёт свои .vpk в папку, которую Dota и так читает. Файлы игры оно не открывает и не меняет.`}</p>
            </div>
          </div>
          <div class="safe-step to">
            <span class="ms safe-step-icon">shield_moon</span>
            <div class="safe-step-text">
              <span class="safe-eyebrow">${L`После`}</span>
              <b>${L`Приложение начнёт менять файлы игры`}</b>
              <p>${L`Оно впишет свою папку с модами в два файла Dota:`}</p>
              <dl class="safe-files">
                <dt><code>gameinfo_branchspecific.gi</code></dt>
                <dd>${L`+ строка с папкой модов`}</dd>
                <dt><code>dota.signatures</code></dt>
                <dd>${L`+ подпись изменённого файла`}</dd>
              </dl>
              <p class="safe-undo">${L`Оригиналы приложение сохраняет до первой правки. Вернёшь безопасный режим, и они встанут на место байт в байт, без следов.`}</p>
              <p class="safe-undo">${L`Дота стирает эту правку каждым обновлением. Приложение впишет её заново само, пока безопасный режим выключен.`}</p>
            </div>
          </div>
        </div>
        <p class="safe-gain">
          <span class="ms">auto_awesome</span>
          <span>${L`Взамен заработают моды с эффектами, а в каталоге откроются виды для стандартных предметов: погода, ландшафт, курьеры, варды и ещё десяток слотов. Стандартный предмет начинает выглядеть как любой другой из игры, и видно это только тебе.`}</span>
        </p>
        <div class="safe-risk">
          <span class="ms">warning</span>
          <div>${L`Правку файлов игры в моддинге Dota считают небезопасной. За 8+ лет мы не знаем ни одного бана за это. Гарантий всё равно не даём.`}</div>
        </div>
        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Оставить безопасный режим`}</button>
          <button class="btn btn-primary" data-c="yes">${L`Выключить безопасный режим`}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v: boolean) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    part(overlay, '[data-c="no"]').addEventListener('click', () => done(false));
    part(overlay, '[data-c="yes"]').addEventListener('click', () => done(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    // staying safe is the answer a stray Enter should give
    part(overlay, '[data-c="no"]').focus();
  });
}

// ---------- the Source 2 toolchain, offered once ----------

/* Dota keeps most of what it draws in compiled Source 2 formats. The app reads the easy half
 * itself - almost every item icon is a PNG sitting inside its .vtex_c (see src/vtex.js) - but
 * the pictures inside a mod are real compiled textures, and those need the program Valve's
 * own format was reverse-engineered into.
 *
 * It is fifty megabytes and somebody else's work, so it is not in the installer and it is not
 * fetched behind anybody's back: this is the one place the app asks, on first run, with the
 * size and the licence on screen. Declining costs the mod previews and nothing else, and
 * Settings has the same button for later.
 *
 * Resolves true to fetch it.
 */
export function toolchainDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box tool-box" role="dialog" aria-modal="true" aria-labelledby="toolDlgTitle">
        <div class="tool-head">
          <span class="ms">extension</span>
          <div>
            <div class="tool-title" id="toolDlgTitle">${L`Скачать Source 2 Viewer?`}</div>
            <div class="tool-sub">${L`Открытая программа (MIT) от ValveResourceFormat, не наша`}</div>
          </div>
        </div>
        <p class="tool-lede">${L`Дота хранит почти всё в сжатых форматах Source 2. Простую половину приложение читает само, а остальное разбирает эта программа.`}</p>
        <ul class="tool-gains">
          <li><span class="ms">image</span><span><b>${L`Превью твоих модов`}</b>${L` — без неё их не видно вовсе`}</span></li>
          <li><span class="ms">apps</span><span><b>${L`Иконки предметов, которые игра хранит сжатыми`}</b>${L` — остальные приложение достаёт из игры само`}</span></li>
        </ul>
        <p class="tool-cost">${L`48 МБ, качается один раз в папку приложения. Удалить можно когда угодно в настройках, ничего сломано не будет.`}</p>
        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Не сейчас`}</button>
          <button class="btn btn-primary" data-c="yes">${L`Скачать`}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v: boolean) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    part(overlay, '[data-c="no"]').addEventListener('click', () => done(false));
    part(overlay, '[data-c="yes"]').addEventListener('click', () => done(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    part(overlay, '[data-c="yes"]').focus();
  });
}
