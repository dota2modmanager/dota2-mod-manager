/* The pumpkin in the title bar, and the window it opens.
 *
 * It is not there to begin with. It rolls in beside the mascot once the mascot has been knocked
 * on twenty times, counted from the first (ui/theme.ts says so with 'mm-knocks'; the site's
 * whispers are where that is learned), and from then on it stays (settings `pumpkin`). It rolls in cold: the candle inside is out, and a click on it says only that it is
 * hungry. What warms it is a spider. Broodmother's children (ui/brood.ts) can be caught and
 * thrown (ui/spiders.ts), and one thrown into the pumpkin is eaten and lights it for good
 * (settings `pumpkinLit`).
 *
 * Lit, it asks for a key. Keys come from the site, one per person, and each opens one pumpkin
 * (src/pumpkin.ts, tools/pumpkin-worker). The right one opens the bloody night, the tenth theme,
 * and brings a mod nobody else has yet into My mods. A key another pumpkin already ate is turned
 * away with that said plainly, since that is the one mistake people will make on purpose.
 *
 * Its words are its own, in the three languages the window speaks, rather than in i18n.js.
 */
import { state } from '../core/store.ts';
import { switchView } from '../core/router.ts';
import { wearBlood } from './theme.ts';
import { PUMPKIN_SVG } from './pumpkin-art.ts';
import { crunch, kindle, hiss, opens } from './dread.ts';
import type { RedeemAnswer } from '../api/app.ts';

type Words = {
  label: string; coldLabel: string; close: string; coldTitle: string; coldText: string; coldHint: string; ate: string;
  title: string; text: string; placeholder: string; hint: string; open: string; chewing: string;
  wrong: string; empty: string; used: string; offline: string; broken: string;
  litTitle: string; litText: string; litNoMod: string; show: string; retry: string; retried: string;
  again: string; againText: string; wear: string; prizeBack: string; heart: string;
};

const WORDS: Record<'ru' | 'en' | 'zh-CN', Words> = {
  ru: {
    label: 'Тыква', coldLabel: 'Остывшая тыква', close: 'Закрыть',
    coldTitle: 'Тыква остыла', coldText: 'Свеча внутри погасла, и тыква голодна. Греет её только живое, а у матери пауков детей хватит на всех.',
    coldHint: 'Пауков ловят руками.', ate: 'Хрум. Тыква горит.',
    title: 'Тыква ждёт ключ', text: 'Свеча снова горит. Внутри что-то прячется, и тыква отдаст это тому, кто принесёт ключ.',
    placeholder: 'XXXX-XXXX-XXXX-XXXX', hint: 'Ключ у того, кто висит в коконе на сайте. Сначала семеро, по порядку. Четвёртого назову я: тот, кто проспал всю зиму. У каждого ключ свой, и каждый открывает одну тыкву.',
    open: 'Открыть', chewing: 'Тыква жуёт…',
    wrong: 'Не тот ключ. Тыква плюётся.', empty: 'Сначала впиши ключ.',
    used: 'Этот ключ уже съела другая тыква. Каждый ключ открывает одну тыкву: добудь свой на сайте.',
    offline: 'Тыква не докричалась до сайта. Проверь интернет и попробуй ещё раз.',
    broken: 'На той стороне что-то сломалось ({0}). Попробуй чуть позже.',
    litTitle: 'Кровавая ночь твоя', litText: 'Тема уже надета, а в «Моих модах» тебя ждёт {0}: включи его, и Некрофос станет Криком. Пока его нет ни у кого, кроме тех, кто добрался сюда.',
    litNoMod: 'Тема уже надета, а мод не скачался: {0}.', show: 'Показать мод', retry: 'Скачать мод', retried: 'Скачано',
    again: 'Кровавая ночь уже твоя', againText: 'Она в круге героев: щёлкай по маскоту, пока он не станет кровавой тыквой.', wear: 'Надеть кровавую ночь', prizeBack: 'Вернуть мод',
    heart: 'Он тебя видел. Там, где на сайте ничего нет, найди его маску.',
  },
  en: {
    label: 'Pumpkin', coldLabel: 'A cold pumpkin', close: 'Close',
    coldTitle: 'The pumpkin has gone cold', coldText: 'The candle inside is out, and the pumpkin is hungry. Only something alive warms it, and the mother of spiders has children enough for everyone.',
    coldHint: 'Spiders are caught by hand.', ate: 'Crunch. The pumpkin is lit.',
    title: 'The pumpkin wants a key', text: 'The candle is burning again. Something is hidden inside, and it goes to whoever brings the key.',
    placeholder: 'XXXX-XXXX-XXXX-XXXX', hint: 'The key is with the one in the cocoon on the site. Seven first, in order. I will name the fourth myself: the one who slept through the winter. Everyone gets their own key, and each one opens one pumpkin.',
    open: 'Open', chewing: 'The pumpkin is chewing…',
    wrong: 'Not that key. The pumpkin spits it out.', empty: 'Type the key first.',
    used: 'Another pumpkin already ate this key. Each key opens one pumpkin: get your own on the site.',
    offline: 'The pumpkin could not reach the site. Check your connection and try again.',
    broken: 'Something broke on the other side ({0}). Try again a little later.',
    litTitle: 'The bloody night is yours', litText: 'The theme is on, and {0} is waiting in My mods: switch it on and Necrophos becomes Scream. Nobody has it yet except the people who made it this far.',
    litNoMod: 'The theme is on, but the mod did not download: {0}.', show: 'Show the mod', retry: 'Download the mod', retried: 'Downloaded',
    again: 'The bloody night is already yours', againText: 'It is in the round of heroes: click the mascot until it turns into a bloody pumpkin.', wear: 'Wear the bloody night', prizeBack: 'Get the mod back',
    heart: 'He saw you. Where there is nothing on the site, find his mask.',
  },
  'zh-CN': {
    label: '南瓜', coldLabel: '冷掉的南瓜', close: '关闭',
    coldTitle: '南瓜凉了', coldText: '里面的蜡烛灭了，南瓜饿了。只有活物能让它暖起来，而蜘蛛之母的孩子多得是。',
    coldHint: '蜘蛛要用手抓。', ate: '咔嚓。南瓜亮了。',
    title: '南瓜在等一把钥匙', text: '蜡烛又亮了。里面藏着东西，谁带来钥匙就归谁。',
    placeholder: 'XXXX-XXXX-XXXX-XXXX', hint: '钥匙在网站上那个挂在茧里的家伙身上。先找七个，按顺序。第四个我亲自告诉你：那个睡过了整个冬天的。每人一把钥匙，每把只能打开一个南瓜。',
    open: '打开', chewing: '南瓜在嚼…',
    wrong: '钥匙不对。南瓜把它吐了出来。', empty: '先输入钥匙。',
    used: '这把钥匙已经被另一个南瓜吃掉了。每把钥匙只能打开一个南瓜：去网站拿你自己的。',
    offline: '南瓜联系不上网站。检查网络后再试一次。',
    broken: '对面出了点问题（{0}）。稍后再试。',
    litTitle: '血腥之夜归你了', litText: '主题已经换上，{0} 正在“我的模组”里等你：启用它，死灵飞龙就会变成惊声尖叫。除了走到这一步的人，还没有人拥有它。',
    litNoMod: '主题已经换上，但模组没有下载成功：{0}。', show: '查看模组', retry: '下载模组', retried: '已下载',
    again: '血腥之夜已经是你的了', againText: '它在英雄轮换里：一直点击吉祥物，直到它变成血色南瓜。', wear: '换上血腥之夜', prizeBack: '找回模组',
    heart: '他看见你了。在网站上什么都没有的地方，找到他的面具。',
  },
};
const words = (): Words => WORDS[(window.I18N_LANG as 'ru' | 'en' | 'zh-CN') ?? 'en'] ?? WORDS.en;
const fill = (s: string, v: string) => s.replace('{0}', v);

/* The drawing is ui/pumpkin-art.ts; the light in its face flickers in styles/pumpkin.css. */
const SVG = PUMPKIN_SVG;

let button: HTMLButtonElement | null = null;
const lit = () => state.settings?.pumpkinLit === true || state.settings?.blood === true;

function dress(): void {
  if (!button) return;
  const w = words();
  const cold = !lit();
  button.classList.toggle('cold', cold);
  button.classList.toggle('bloody', state.settings?.blood === true);
  button.title = cold ? w.coldLabel : w.label;
  button.setAttribute('aria-label', button.title);
}

function show(rolling: boolean): void {
  if (button) return;
  const mascot = document.querySelector('#themeMascot');
  if (!mascot) return;
  button = document.createElement('button');
  button.className = `tb-pumpkin${rolling ? ' rolling' : ''}`;
  button.type = 'button';
  button.innerHTML = SVG;
  button.addEventListener('click', () => keyWindow());
  mascot.after(button);
  dress();
}

/** A spider was thrown into it (ui/spiders.ts): it eats, and the first one lights it. */
function onEaten(): void {
  if (!button) return;
  button.classList.remove('chomp');
  void button.offsetWidth;
  button.classList.add('chomp');
  crunch();
  if (lit()) return;
  kindle();
  window.api.settings.set('pumpkinLit', true);
  if (state.settings) state.settings.pumpkinLit = true;
  dress();
  button.classList.add('kindled');
  document.dispatchEvent(new Event('mm-pumpkin-lit'));
}

export function initPumpkin(): void {
  if (state.settings?.pumpkin === true) show(false);
  document.addEventListener('mm-knocks', () => {
    if (button) return;
    show(true);
    window.api.settings.set('pumpkin', true);
    if (state.settings) state.settings.pumpkin = true;
  });
  document.addEventListener('mm-spider-eaten', onEaten);
}

/** The window: cold and hungry, or lit and waiting for a key, or already opened. */
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
          <button class="btn" type="button" data-c="extra" hidden></button>
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
  const extra = q<HTMLButtonElement>('[data-c="extra"]');
  const ok = q<HTMLButtonElement>('[data-c="ok"]');
  input.placeholder = w.placeholder;
  cancel.textContent = w.close;

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); document.removeEventListener('mm-pumpkin-lit', asKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  cancel.addEventListener('click', close);
  let busy = false;

  /** The key opened it; `fresh` when it happened this very moment. */
  const opened = async (fresh: boolean, answer?: Extract<RedeemAnswer, { ok: true }>) => {
    box.classList.remove('cold');
    box.classList.add('lit', 'blood');
    if (fresh) { box.classList.add('burst'); opens(); }
    input.hidden = true;
    hint.hidden = false;
    hint.textContent = w.heart;
    hint.classList.add('pk-heart');
    error.textContent = '';
    extra.hidden = true;
    if (fresh) {
      title.textContent = w.litTitle;
      text.textContent = answer?.installed ? fill(w.litText, answer.installed) : fill(w.litNoMod, answer?.installError || '?');
      ok.textContent = answer?.installed ? w.show : w.retry;
      ok.onclick = async (e) => {
        e.preventDefault();
        if (ok.textContent === w.show) { close(); void switchView('library'); return; }
        await fetchAgain();
      };
      cancel.hidden = false;
      ok.focus();
      return;
    }
    title.textContent = w.again;
    text.textContent = w.againText;
    ok.textContent = w.wear;
    ok.onclick = (e) => { e.preventDefault(); wearBlood(); close(); };
    if (!(await window.api.pumpkin.hasPrize())) {
      extra.hidden = false;
      extra.textContent = w.prizeBack;
      extra.onclick = () => fetchAgain();
    }
    ok.focus();
  };

  const fetchAgain = async () => {
    if (busy) return;
    busy = true;
    const btn = extra.hidden ? ok : extra;
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = w.chewing;
    const r = await window.api.pumpkin.prizeAgain();
    busy = false;
    btn.disabled = false;
    if ('error' in r) { btn.textContent = was; error.textContent = fill(w.litNoMod, r.error); return; }
    error.textContent = '';
    btn.textContent = w.retried;
    btn.disabled = true;
  };

  // cold: nothing to type, only the riddle; it turns into the key window if fed meanwhile
  const asCold = () => {
    box.classList.add('cold');
    title.textContent = w.coldTitle;
    text.textContent = w.coldText;
    hint.textContent = w.coldHint;
    input.hidden = true;
    ok.hidden = true;
  };
  const asKey = () => {
    box.classList.remove('cold');
    if (!overlay.isConnected) return;
    if (!box.classList.contains('was-cold')) box.classList.add('was-cold');
    title.textContent = w.title;
    text.textContent = w.text;
    hint.textContent = w.hint;
    input.hidden = false;
    ok.hidden = false;
    ok.textContent = w.open;
    input.focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || input.hidden) return;
    if (!input.value.trim()) { error.textContent = w.empty; input.focus(); return; }
    busy = true;
    ok.disabled = true;
    ok.textContent = w.chewing;
    error.textContent = '';
    const answer = await window.api.pumpkin.redeem(input.value);
    busy = false;
    ok.disabled = false;
    ok.textContent = w.open;
    if ('ok' in answer) {
      // the key opens the ninth theme as well, for whoever never had it
      window.api.settings.set('secret', true);
      if (state.settings) { state.settings.blood = true; state.settings.secret = true; }
      dress();
      wearBlood();
      void opened(true, answer);
      return;
    }
    error.textContent = answer.error === 'used' ? w.used
      : answer.error === 'offline' ? w.offline
        : answer.error === 'broken' ? fill(w.broken, answer.detail || '?')
          : answer.error === 'empty' ? w.empty : w.wrong;
    hiss();
    if (answer.error === 'wrong') {
      // the pumpkin lunges: its face fills the window for a moment
      box.classList.remove('scream');
      void box.offsetWidth;
      box.classList.add('scream');
    }
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
    input.select();
  });

  if (state.settings?.blood === true) void opened(false);
  else if (!lit()) { asCold(); document.addEventListener('mm-pumpkin-lit', asKey); }
  else asKey();
}
