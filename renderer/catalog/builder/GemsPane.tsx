import { useId, useState, type CSSProperties } from 'react';
import type { ArcanaWindow, GemArt, GemColor } from '../../api/content.ts';
import { toast } from '../../ui/toast.ts';
import { fromHex, gemOf, toHex, type Rgb } from '../arcana/tint.ts';
import { refreshInstalledIndex } from '../../core/installed.ts';

export function GemsPane({ set, item, gems, art, color, equipped, unavailable, choose, saved }: {
  set: string; item?: ArcanaWindow; gems: GemColor[]; art?: GemArt | null; color: Rgb; equipped: boolean; unavailable: boolean;
  choose: (color: Rgb | null) => void; saved: (item: ArcanaWindow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState<string | null>(null);
  const value = toHex(color);
  const valid = hex === null || fromHex(hex) !== null;
  /* Worn through the builder, the arcana's base comes with the pick and the record colours it
   * (src/arcana-base-color.ts); `own`: the player has the item in the game, and only its effects
   * are coloured, over the one Valve's files give them. Either way the record is the colour alone,
   * unless the arcana window built the whole arcana before. */
  const install = async (own = false) => {
    if (busy || (!equipped && !own) || !item?.available || !valid) return;
    setBusy(true);
    try {
      const mode = own ? 'recolor' : item.installed?.mode ?? 'recolor';
      const result = await window.api.arcana.install(set, color, mode);
      if (result.error) { toast(result.error, 'error'); return; }
      saved({ ...item, installed: { id: result.record.id, mode, color, enabled: result.record.enabled !== false } });
      await refreshInstalledIndex();
      toast(L`Цвет сохранён в «Моих модах»`);
    } catch (error) { toast(String(error), 'error'); }
    finally { setBusy(false); }
  };
  const pick = (rgb: Rgb | null) => { setHex(null); choose(rgb); };
  const original = toHex(gemOf(set));
  const colors: GemColor[] = gems.some(gem => toHex(gem.rgb) === original) ? gems : [
    { key: 'original', name: L`Как в игре`, rgb: gemOf(set) }, ...gems,
  ];
  const isCustom = !colors.some(gem => toHex(gem.rgb) === value);
  const card = (name: string, tint: string, icon: string, picture?: string) => <>
    <div className="card-media" style={{ '--gem-color': tint } as CSSProperties}>
      {picture ? <img className="ward-gem-native" src={picture} alt="" /> : icon === 'diamond' && art ? <span className="ward-gem-art" aria-hidden="true">
        <img src={art.image} alt="" />
        {art.mask && <>
          <span className="ward-gem-tint" style={{ maskImage: `url("${art.mask}")` }} />
          <img className="ward-gem-facets" src={art.mask} alt="" />
        </>}
      </span> : <span className="ms" aria-hidden="true">{icon}</span>}
    </div>
    <div className="card-body"><div className="card-name">{name}</div></div>
  </>;
  return <section className="ward-shelf ward-gems">
    {!equipped && <div className="ward-shelf-note">{L`Надень предмет, чтобы увидеть цвет в 3D и сохранить его. Если он уже есть у тебя в игре, можно покрасить только его эффекты.`}</div>}
    {unavailable && <p role="alert">{L`Не удалось загрузить самоцветы`}</p>}
    <fieldset className="item-pick-grid ward-grid fx-grid ward-gem-grid" disabled={busy}>
      <div className="ward-gem-custom" onKeyDown={e => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          setHex(null);
          e.currentTarget.querySelector('button')?.focus();
        }
      }}>
        <button type="button" className={`card item-pick-card fx-card ward-gem-card ${isCustom ? 'picked' : ''}`}
          aria-expanded={open} aria-controls={pickerId} onClick={() => { setOpen(!open); setHex(null); }}>
          {card(L`Свой цвет`, value, 'colorize')}
        </button>
        <div className="ward-gem-picker" id={pickerId} hidden={!open}>
          <input type="color" value={value} onChange={e => pick(fromHex(e.currentTarget.value))} aria-label={L`Свой цвет`} />
          <input type="text" value={hex ?? value.toUpperCase()} maxLength={7} aria-label="HEX" aria-invalid={!valid}
            onChange={e => { const text = e.currentTarget.value; setHex(text); const rgb = fromHex(text); if (rgb) choose(rgb); }}
            onBlur={() => { if (valid) setHex(null); }} />
        </div>
      </div>
      {colors.map(gem => {
        const tint = toHex(gem.rgb);
        const selected = value === tint;
        return <button type="button" key={gem.key} title={gem.name} aria-pressed={selected}
          className={`card item-pick-card fx-card ward-gem-card ${selected ? 'picked' : ''}`}
          onClick={() => { pick(gem.rgb); setOpen(false); }}>
          {card(gem.name, tint, 'diamond', gem.picture)}
        </button>;
      })}
    </fieldset>
    <div className="ward-gem-actions">
      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { pick(null); setOpen(false); }}>{L`Сбросить изменения`}</button>
      {!equipped && <button className="btn btn-sm btn-ghost" id="gemOwnBtn" disabled={busy || !valid || !item?.available} onClick={() => void install(true)}
        title={L`Для предмета, который уже есть у тебя в игре: красятся только эффекты, модель остаётся игровой`}>
        <span className="ms">auto_fix_high</span>{L`Только эффекты`}
      </button>}
      <button className="btn btn-primary" disabled={busy || !valid || !equipped || !item?.available} onClick={() => void install()}>
        <span className="ms">{busy ? 'progress_activity' : 'palette'}</span>{busy ? L`Собираю…` : L`Сохранить цвет`}
      </button>
    </div>
  </section>;
}
