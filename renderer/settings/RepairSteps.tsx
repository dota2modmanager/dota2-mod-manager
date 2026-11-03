/* What Settings' "Repair the app" found, a line per step (src/app-repair.ts). A red line points at
 * the support report under it: the report shows the step that failed. */

/** One run of the repair: still going, or its lines. */
export type RepairRun = { busy: boolean; steps: Array<{ id: string; ok: boolean; text: string; mods?: string[] }> };

/** The lines of the last run, and the nudge towards the report when one of them is red. */
export function RepairSteps({ run }: { run: RepairRun | null }) {
  if (!run || !run.steps.length) return null;
  return (
    <>
      <ul className="repair-steps" id="repairSteps" aria-live="polite">
        {run.steps.map((s) => (
          <li key={s.id} className={s.ok ? 'ok' : 'bad'}>
            <span className="ms">{s.ok ? 'check_circle' : 'error'}</span>
            <span>{s.text}{s.mods?.length ? <span className="repair-mods">{s.mods.join(', ')}</span> : null}</span>
          </li>
        ))}
      </ul>
      {run.steps.some((s) => !s.ok) && <div className="settings-hint">{L`Не вышло? Отправь отчёт: в нём видно, на каком шаге.`}</div>}
    </>
  );
}
