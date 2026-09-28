/* One banner over a screen: an icon, what it says, and at most one thing to do about it. */
import type { ReactNode } from 'react';

export function Banner({ kind, icon, children, action }: { kind: string; icon: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner ${kind}`}>
      <span className="ms">{icon}</span>
      <div className="banner-body">{children}</div>
      {action}
    </div>
  );
}

export function BannerButton({ id, icon, label, ghost, onClick, disabled }: {
  id?: string; icon?: string; label: string; ghost?: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button className={`btn btn-sm ${ghost ? 'btn-ghost' : 'btn-primary'}`} id={id} disabled={disabled} onClick={onClick}>
      {icon && <span className="ms">{icon}</span>}{label}
    </button>
  );
}
