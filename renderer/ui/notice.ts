/* Notices that arrive from the network, not from the code.
 *
 * One banner, on the two screens people actually stand on. It shows the newest thing the app
 * has been told and has not been dismissed yet - "Dota patched today, effects mods crash the
 * client, don't install them until tomorrow" is the kind of thing that has to reach somebody
 * on the day, not in the next release. Dismissing is per notice id and remembered, so it says
 * a thing once and then gets out of the way.
 *
 * The whole list stays readable afterwards in What's new (see ui/dialog.ts): a banner is for
 * now, the list is for "what did that message say again".
 */
import { esc } from './format.ts';
import type { Notice } from '../api/content.ts';

type NoticeState = { notices: Notice[]; seen: string[]; features: Record<string, unknown> };

let state: NoticeState = { notices: [], seen: [], features: {} };

/** Ask the main process what it knows. Cheap; every screen that draws the banner calls it. */
export async function refreshNotices(): Promise<NoticeState> {
  try { state = await window.api.config.state(); } catch { /* keep whatever we had */ }
  return state;
}

/** The newest notice this user has not put away, or null. */
function liveNotice(): Notice | null {
  const seen = new Set(state.seen || []);
  return (state.notices || []).find((n) => !seen.has(n.id)) || null;
}

export function noticeBannerHtml(): string {
  const n = liveNotice();
  if (!n) return '';
  return `
    <div class="banner ${n.level === 'warn' ? 'warn' : 'info'}" data-notice="${esc(n.id)}">
      <span class="ms">${n.level === 'warn' ? 'warning' : 'campaign'}</span>
      <div class="banner-body">${esc(n.text)}${n.url ? ` <a href="#" class="notice-link" data-url="${esc(n.url)}">${L`Подробнее`}</a>` : ''}</div>
      <button class="btn btn-sm btn-ghost" data-notice-seen="${esc(n.id)}">${L`Понятно`}</button>
    </div>`;
}

/** Wire the banner that noticeBannerHtml() just drew. `after` redraws the screen it sits on. */
export function bindNotice(root: ParentNode, after?: () => void): void {
  root.querySelector<HTMLElement>('[data-notice-seen]')?.addEventListener('click', async (e) => {
    const id = (e.currentTarget as HTMLElement).dataset.noticeSeen || '';
    state = await window.api.config.noticeSeen(id).then(() => window.api.config.state()).catch(() => state);
    if (after) after();
  });
  root.querySelector<HTMLElement>('.notice-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.misc.openExternal((e.currentTarget as HTMLElement).dataset.url || '');
  });
}
