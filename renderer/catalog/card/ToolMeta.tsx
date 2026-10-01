/* A tool says different things than a mod, so its line under the name says them: what the card
 * leads to on the left, and what comes with it on the right. This is the shape the catalog's own
 * site gives these cards. An installed one drops the verb: the green frame and the tick have
 * already answered it. */
import type { Mod } from '../types.ts';
import { catalogData } from '../data.ts';
import { installTarget } from '../mods.ts';

export function ToolMeta({ mod: m, installed }: { mod: Mod; installed: boolean }) {
  // the catalog hangs its safety warning on the tool as a guide; the author paints that one red
  // instead of calling it a guide, and it is the one thing worth reading before a download
  const unsafe = m.guideId === 'warning';
  const pills: { text: string; cls: string }[] = [];
  if (!unsafe && (m.links || []).some((l) => l.type === 'source-code')) pills.push({ text: L`Исходники`, cls: 'soft' });
  if (unsafe) pills.push({ text: L`Небезопасно`, cls: 'danger' });
  else if (typeof m.guideId === 'string' && catalogData()?.guides?.[m.guideId]) pills.push({ text: L`Гайд`, cls: 'soft' });

  /* One line, and 190px of it, so the pills are served first: a warning shortened to "НЕБЕЗ..." is
   * worse than no warning at all. The warning takes the row on its own, and the verb goes as soon
   * as two pills are there. Measured in both languages: Russian runs the longer of the two here. */
  const verb = installed || pills.length > 1 || unsafe ? '' : (installTarget(m) ? tr('Скачать') : tr('Открыть'));
  if (!verb && !pills.length) return null;
  return (
    <div className="card-meta card-meta-split">
      {verb && <span>{verb}</span>}
      {pills.length > 0 && (
        <span className="card-pills">
          {pills.map((p) => <span key={p.text} className={`mtag ${p.cls}`}>{p.text}</span>)}
        </span>
      )}
    </div>
  );
}
