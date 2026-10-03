/* What preload-uninstall.js puts on window for the removal window (renderer/uninstall.js), with
 * the answers src/uninstall-window.ts gives. The removal window is a classic script, loaded
 * without a build, so it is type-checked through its JSDoc by tsconfig.json at the root, the way
 * the preloads are. renderer/tsconfig.json leaves this file out: the main window has no such
 * bridge. */
export {};

declare global {
  /** What there is to remove, so the window can say it rather than ask in the abstract. */
  interface UninstallPlan {
    mods: number;
    modBytes: number;
    patched: boolean;
    gamePath: string | null;
    dataBytes: number;
    lang: 'ru' | 'en';
  }

  /** L`Текст ${x}`, published by i18n.js, which uninstall.html loads first. */
  function L(strings: TemplateStringsArray | string, ...values: unknown[]): string;

  interface Window {
    /** the language the app was being used in, set from the plan */
    I18N_LANG: 'ru' | 'en';
    uninstall: {
      plan(): Promise<UninstallPlan>;
      run(choices: { revert: boolean; mods: boolean; data: boolean }): Promise<{ ok: true; errors: string[] }>;
      done(wipeData?: boolean): Promise<void>;
      cancel(): Promise<void>;
    };
  }
}
