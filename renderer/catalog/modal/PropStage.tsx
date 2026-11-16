/* The 3D side of a mod of the world's window (stage.ts): a ward, a creep, a tower, Roshan, an
 * ancient, the Tormentor, a courier, a pedestal or a tree set, on the hero stage (Preview3d.tsx),
 * which plays a body's clip and its particles. The main process makes one of the mod's models the
 * body, with the effects its model lists (a ward's glow, an ancient's ambience), and stands the
 * others beside it (crates/mm-core/src/models/mod_props.rs); with more than one, a tab picks which
 * is the body. Until it comes, and when nothing can be had, the mod's picture stands there. */
import { useState, type ReactNode } from 'react';
import { Preview3d } from '../preview3d/Preview3d.tsx';
import type { ModStage as Stage } from './stage.ts';

/** "models/props_gameplay/default_ward.vmdl" as "default ward". */
const modelName = (m: string) => (m.split('/').pop() ?? m).replace(/\.vmdl$/i, '').replace(/_/g, ' ');

export function PropStage({ stage, picture }: { stage: Stage; picture: ReactNode }) {
  const [index, setIndex] = useState(0);
  const [models, setModels] = useState<string[]>([]);
  const key = `${stage.category}|${stage.file}`;
  return (
    <div className="prop-stage-wrap">
      <Preview3d hero={`prop:${key}`} slots={[]} sig={`${key}|${index}`} fallback={picture} waiting={L`Скачиваю мод и собираю модели…`}
        load={async () => {
          const r = await window.api.preview3d.modProps(stage.category, stage.file, index);
          if (r.ok && r.models) setModels(r.models);
          return r;
        }} />
      {models.length > 1 && (
        <div className="prop-stage-tabs" role="tablist" aria-label={L`Модели мода`}>
          {models.map((m, i) => (
            <button key={m} role="tab" aria-selected={i === index} className={i === index ? 'on' : ''} title={m} onClick={() => setIndex(i)}>
              {modelName(m)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
