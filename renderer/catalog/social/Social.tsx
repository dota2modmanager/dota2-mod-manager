/* The like on a mod and the follow of an author, as the window and the cards draw them
 * (core/social.ts holds the state). Nothing is drawn while the catalog's account service is off. */
import { useSyncExternalStore } from 'react';
import type { SocialState } from '../../api/app.ts';
import { followersOf, following, liked, likesOf, onSocial, social, toggleFollow, toggleLike } from '../../core/social.ts';
import { formatCount } from '../../core/download-counts.ts';

/** The state, kept current. */
export function useSocial(): SocialState {
  return useSyncExternalStore(onSocial, social);
}

/** The window's like: the count beside it, lit while it is the user's. */
export function LikeButton({ k }: { k: string }) {
  const s = useSocial();
  if (!s.enabled) return null;
  const on = liked(k);
  const n = likesOf(k);
  const label = on ? L`Убрать лайк` : s.signedIn ? L`Нравится` : L`Нравится (нужен вход через Discord)`;
  return (
    <button className={`like-btn ${on ? 'on' : ''}`} id="modLikeBtn" aria-pressed={on} title={label} aria-label={label}
      onClick={() => void toggleLike(k)}>
      <span className="ms">thumb_up</span>
      {n > 0 && <span>{formatCount(n)}</span>}
    </button>
  );
}

/** How many liked this mod; 0 while the service is off. */
export function useLikeCount(k: string): number {
  const s = useSocial();
  return s.enabled ? likesOf(k) : 0;
}

/** A card's count of likes, beside its downloads; nothing until somebody liked it. */
export function LikeCount({ k }: { k: string }) {
  const s = useSocial();
  const n = s.enabled ? likesOf(k) : 0;
  if (!n) return null;
  const on = liked(k);
  return (
    <span className={`like-count ${on ? 'on' : ''}`} title={L`Лайков: ${n}`} aria-label={L`Лайков: ${n}`}>
      <span className="ms">thumb_up</span>{formatCount(n)}
    </span>
  );
}

/** Following an author: in the window's creator block and on the author's page. */
export function FollowButton({ author }: { author: string }) {
  const s = useSocial();
  if (!s.enabled || !author) return null;
  const on = following(author);
  const n = followersOf(author);
  const title = on ? L`Отписаться от ${author}` : L`Подписаться на ${author}: о новых модах автора скажу при запуске`;
  return (
    <button className={`btn btn-sm follow-btn ${on ? 'on' : ''}`} aria-pressed={on} title={title}
      onClick={() => void toggleFollow(author)}>
      <span className="ms">{on ? 'notifications_active' : 'notifications'}</span>
      {on ? L`Ты подписан` : L`Подписаться`}
      {n > 0 && <span className="follow-n">{formatCount(n)}</span>}
    </button>
  );
}
