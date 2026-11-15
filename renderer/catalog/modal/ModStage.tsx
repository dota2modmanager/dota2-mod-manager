/* The 3D side of a hero mod's window (stage.ts): the item builder's stage, fed from the mod's
 * archive over the game's files. It first asks which hero the mod is for, which downloads the mod
 * the first time, then the hero in the game's own items with the mod's files in them. Until then,
 * and when no model can be had, the mod's picture stands where the hero will be. */
import { useEffect, useState, type ReactNode } from 'react';
import { Preview3d } from '../preview3d/Preview3d.tsx';
import type { PreviewSlot } from '../../api/preview3d.ts';
import { stockSlots, type ModStage as Stage } from './stage.ts';

type Ready = { kind: 'wait' } | { kind: 'shown'; hero: string; slots: PreviewSlot[] } | { kind: 'none'; text: string };

let slotList: Promise<Awaited<ReturnType<typeof window.api.cosmetics.slots>>> | null = null;
/** The item builder's slots, asked for once: every hero's stock items are in them. */
const allSlots = () => (slotList ??= window.api.cosmetics.slots().catch((e: unknown) => { slotList = null; throw e; }));

export function ModStage({ stage, picture }: { stage: Stage; picture: ReactNode }) {
  const [ready, setReady] = useState<Ready>({ kind: 'wait' });
  const key = `${stage.category}|${stage.file}`;
  useEffect(() => {
    let gone = false;
    setReady({ kind: 'wait' });
    void (async () => {
      try {
        const [who, all] = await Promise.all([window.api.preview3d.modHero(stage.category, stage.file, stage.hint), allSlots()]);
        if (gone) return;
        if (who.error) { setReady({ kind: 'none', text: who.error }); return; }
        if (!who.hero) { setReady({ kind: 'none', text: L`Не понял, для какого героя этот мод` }); return; }
        setReady({ kind: 'shown', hero: who.hero, slots: stockSlots(all.slots ?? [], who.hero) });
      } catch (err) {
        if (!gone) setReady({ kind: 'none', text: String((err as Error)?.message || err) });
      }
    })();
    return () => { gone = true; };
    // the stage is the mod's file; a new object each draw is not a new mod
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (ready.kind === 'shown') {
    return (
      <Preview3d hero={ready.hero} slots={ready.slots} sig={key} fallback={picture} waiting={L`Собираю героя с файлами мода…`}
        load={(hero, slots) => window.api.preview3d.modModels(stage.category, stage.file, hero, slots)} />
    );
  }
  return (
    <div className="preview3d preview3d-studio" id="preview3d" data-status={ready.kind === 'wait' ? 'loading' : 'failed'}>
      {picture}
      {ready.kind === 'wait'
        ? <div className="preview3d-note"><span className="ms">progress_activity</span>{L`Скачиваю мод…`}</div>
        : <div className="preview3d-missing" title={ready.text}>{ready.text}</div>}
    </div>
  );
}
