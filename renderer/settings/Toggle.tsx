/* The on/off switch of a settings row. */

/** A switch: on or off, its label for screen readers, and what a press does. */
export function Toggle({ id, on, label, onClick, disabled }: { id: string; on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return <button className={`toggle ${on ? 'on' : ''}`} id={id} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick} />;
}
