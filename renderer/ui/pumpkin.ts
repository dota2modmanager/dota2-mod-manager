/* The pumpkin in the title bar, and the window it opens.
 *
 * It is not there to begin with. It rolls in beside the mascot once the window has worn all eight
 * heroes (ui/theme.ts says so with 'mm-all-heroes'), and from then on it stays (settings
 * `pumpkin`). A click on it asks for a key; ui/secret-lock.ts says whether it fits, and the right
 * one adds the ninth theme to the mascot's round and puts it on at once, in today's look
 * (ui/season.ts): Halloween's while it is on, the rainbow otherwise.
 *
 * Its words are its own, in the three languages the window speaks, rather than in i18n.js.
 */
import { state } from '../core/store.ts';
import { opens } from './secret-lock.ts';
import { wearSecret } from './theme.ts';
import { lookOn, type Look } from './season.ts';

type Lit = { litTitle: string; litText: string; again: string; wear: string };
type Words = {
  label: string; title: string; text: string; placeholder: string; hint: string;
  open: string; close: string; wrong: string; empty: string; done: string;
  lit: Record<Look, Lit>;
};

const WORDS: Record<'ru' | 'en' | 'zh-CN', Words> = {
  ru: {
    label: 'Тыква', title: 'Тыква ждёт ключ', text: 'Она что-то прячет внутри и отдаст это тому, кто принесёт ключ.',
    placeholder: 'Ключ', hint: 'Ключ у того, кто убегает. Он прячется на сайте.',
    open: 'Открыть', close: 'Закрыть', wrong: 'Не тот ключ. Тыква молчит.', empty: 'Сначала впиши ключ.', done: 'Ура',
    lit: {
      rainbow: { litTitle: 'Радуга твоя', litText: 'Девятая тема теперь в кругу героев: щёлкай по маскоту, и она придёт после восьмого.', again: 'Радуга уже твоя', wear: 'Надеть радугу' },
      halloween: { litTitle: 'Хеллоуин твой', litText: 'Девятая тема теперь в кругу героев: щёлкай по маскоту, и она придёт после восьмого. Пока идёт Хеллоуин, она в паутине, а в обычные дни станет радугой.', again: 'Хеллоуин уже твой', wear: 'Надеть Хеллоуин' },
    },
  },
  en: {
    label: 'Pumpkin', title: 'The pumpkin wants a key', text: 'Something is hidden inside, and it goes to whoever brings the key.',
    placeholder: 'Key', hint: 'The key is with the one that runs away. It hides on the site.',
    open: 'Open', close: 'Close', wrong: 'Not that key. The pumpkin stays shut.', empty: 'Type the key first.', done: 'Yay',
    lit: {
      rainbow: { litTitle: 'The rainbow is yours', litText: 'A ninth theme has joined the heroes: click the mascot, and it comes after the eighth.', again: 'The rainbow is already yours', wear: 'Wear the rainbow' },
      halloween: { litTitle: 'Halloween is yours', litText: 'A ninth theme has joined the heroes: click the mascot, and it comes after the eighth. While Halloween is on it wears cobwebs, and on ordinary days it turns into a rainbow.', again: 'Halloween is already yours', wear: 'Wear Halloween' },
    },
  },
  'zh-CN': {
    label: '南瓜', title: '南瓜在等一把钥匙', text: '里面藏着东西，谁带来钥匙就归谁。',
    placeholder: '钥匙', hint: '钥匙在那个会逃跑的家伙身上。它躲在网站上。',
    open: '打开', close: '关闭', wrong: '钥匙不对。南瓜一声不吭。', empty: '先输入钥匙。', done: '好耶',
    lit: {
      rainbow: { litTitle: '彩虹归你了', litText: '第九个主题加入了英雄的轮换：点击吉祥物，它会排在第八个之后。', again: '彩虹已经是你的了', wear: '换上彩虹' },
      halloween: { litTitle: '万圣节归你了', litText: '第九个主题加入了英雄的轮换：点击吉祥物，它会排在第八个之后。万圣节期间它挂满蛛网，平常日子会变成彩虹。', again: '万圣节已经是你的了', wear: '换上万圣节' },
    },
  },
};
const words = (): Words => WORDS[(window.I18N_LANG as 'ru' | 'en' | 'zh-CN') ?? 'en'] ?? WORDS.en;

/* A jack-o'-lantern: the face is cut out of the body and lit from inside, and the light is what
   flickers (styles/pumpkin.css). One drawing for the title bar and for the window. */
const SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <path class="pk-stem" d="M30 14c0-5 2-9 7-11l2 3c-3 2-4 4-4 8z"/>
  <path class="pk-body" d="M32 15c-6-4-17-3-23 4C2 27 2 43 9 51c6 7 16 9 23 6 7 3 17 1 23-6 7-8 7-24 0-32-6-7-17-8-23-4z"/>
  <path class="pk-rib" d="M32 15c-5 6-6 34 0 42M32 15c5 6 6 34 0 42M19 17c-7 9-7 29 2 38M45 17c7 9 7 29-2 38"/>
  <g class="pk-face">
    <path d="M16 31l7-7 6 8z"/><path d="M48 31l-7-7-6 8z"/>
    <path d="M14 39c5 7 12 10 18 10s13-3 18-10l-5 2-3-4-4 5-6-4-6 4-4-5-3 4z"/>
  </g>
</svg>`;

let button: HTMLButtonElement | null = null;

function show(rolling: boolean): void {
  if (button) return;
  const mascot = document.querySelector('#themeMascot');
  if (!mascot) return;
  button = document.createElement('button');
  button.className = `tb-pumpkin${rolling ? ' rolling' : ''}`;
  button.type = 'button';
  button.title = words().label;
  button.setAttribute('aria-label', words().label);
  button.innerHTML = SVG;
  button.addEventListener('click', () => keyWindow());
  mascot.after(button);
}

export function initPumpkin(): void {
  if (state.settings?.pumpkin === true) show(false);
  document.addEventListener('mm-all-heroes', () => {
    if (button) return;
    show(true);
    window.api.settings.set('pumpkin', true);
    if (state.settings) state.settings.pumpkin = true;
  });
}

/** The window: a key in, and either a shut pumpkin or a lit one out. */
function keyWindow(): void {
  const w = words();
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay pk-overlay';
  overlay.innerHTML = `
    <div class="confirm-box pk-box" role="dialog" aria-modal="true" aria-labelledby="pkTitle">
      <div class="pk-big">${SVG}</div>
      <div class="pk-title" id="pkTitle"></div>
      <p class="pk-text"></p>
      <form class="pk-form">
        <input class="pk-input" spellcheck="false" autocomplete="off" maxlength="40">
        <p class="pk-error" role="alert"></p>
        <p class="pk-hint"></p>
        <div class="confirm-actions">
          <button class="btn" type="button" data-c="close"></button>
          <button class="btn btn-primary" type="submit" data-c="ok"></button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  const q = <T extends HTMLElement>(sel: string) => overlay.querySelector(sel) as T;
  const box = q<HTMLElement>('.pk-box');
  const title = q<HTMLElement>('.pk-title');
  const text = q<HTMLElement>('.pk-text');
  const form = q<HTMLFormElement>('.pk-form');
  const input = q<HTMLInputElement>('.pk-input');
  const error = q<HTMLElement>('.pk-error');
  const hint = q<HTMLElement>('.pk-hint');
  const cancel = q<HTMLButtonElement>('[data-c="close"]');
  const ok = q<HTMLButtonElement>('[data-c="ok"]');
  input.placeholder = w.placeholder;
  cancel.textContent = w.close;

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  cancel.addEventListener('click', close);

  // lit: the rainbow is earned; `fresh` when it was earned this very moment
  const lit = (fresh: boolean) => {
    const look = lookOn(new Date());
    const l = w.lit[look];
    box.classList.add('lit', look);
    if (fresh) box.classList.add('burst');
    title.textContent = fresh ? l.litTitle : l.again;
    text.textContent = l.litText;
    input.hidden = true;
    hint.hidden = true;
    // the moment it opens there is one thing to say, and it is not "close"
    cancel.hidden = fresh;
    error.textContent = '';
    ok.textContent = fresh ? w.done : l.wear;
    ok.onclick = (e) => { e.preventDefault(); if (!fresh) wearSecret(); close(); };
    ok.focus();
  };

  if (state.settings?.secret === true) { lit(false); return; }

  title.textContent = w.title;
  text.textContent = w.text;
  hint.textContent = w.hint;
  ok.textContent = w.open;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value.trim()) { error.textContent = w.empty; input.focus(); return; }
    if (await opens(input.value)) {
      window.api.settings.set('secret', true);
      if (state.settings) state.settings.secret = true;
      wearSecret();
      lit(true);
      return;
    }
    error.textContent = w.wrong;
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
    input.select();
  });
  input.focus();
}
