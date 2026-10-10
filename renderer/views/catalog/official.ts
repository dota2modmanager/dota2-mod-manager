// Browsing Valve's own schema is read-only. The existing safe-mode dialog still owns consent
// and patching; a source filter must never switch it off on the user's behalf.
import { state } from '../../core/store.ts';
import { officialOnly } from '../../catalog/source.ts';

export function showOfficialHint(banners: HTMLElement): void {
  if (!officialOnly()) return;
  const el = document.createElement('div');
  el.className = 'banner official-note';
  el.id = 'officialCosmeticsNote';
  const text = document.createElement('span');
  text.textContent = state.settings?.schemaPatch
    ? L`Предметы из файлов Dota 2. Внешние моды и дополнительные эффекты здесь не показываются.`
    : L`Можно смотреть официальные предметы. Чтобы надеть их, закрой Dota 2 и выключи безопасный режим.`;
  el.append(text);
  if (!state.settings?.schemaPatch) {
    const button = document.createElement('button');
    button.className = 'btn btn-ghost btn-sm';
    button.textContent = L`Выключить безопасный режим`;
    button.addEventListener('click', () => document.getElementById('safeModeBtn')?.click());
    el.append(button);
  }
  banners.append(el);
}
