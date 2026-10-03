/* Is this feature switched off right now?
 *
 * `config/app.json` can turn a feature off after a release (see remote-config.js). The check
 * belongs on the main-process side of every channel it guards, because that is the boundary a
 * stale window, an old screen and a replayed click all have to come through.
 *
 * It lives here, on its own, for a duller reason. It used to be a local helper inside
 * ipc-game.js, and when registerIpc was split into modules on 2026-09-06 the call went to
 * ipc-mods.js while the helper stayed behind. `mods:install` then threw "blocked is not
 * defined" on every single click: no mod could be installed at all, in 2.6.5 and 2.6.6, and
 * the app said nothing - the renderer awaited a promise that rejected, so the button sat on
 * "Installing…" forever.
 *
 * One definition, handed to whoever needs it, so there is no second copy to leave behind.
 */
import { t } from './i18n.ts';
import type { Settings } from './settings.ts';

/** What of the remote config this asks: whether a feature is off, and why, in the user's language. */
interface FeatureSwitches {
  feature(name: string, lang: 'ru' | 'en'): { off: boolean; note?: string };
}

/** @returns the answer to send back, or null to carry on */
export function createGate({ remoteConfig, settings }: {
  remoteConfig: FeatureSwitches; settings: Pick<Settings, 'get'>;
}): (name: string) => { error: string } | null {
  const uiLang = () => (settings.get('uiLang') === 'ru' ? 'ru' : 'en');
  return (name) => {
    const f = remoteConfig.feature(name, uiLang());
    return f.off ? { error: f.note || t('Эта возможность временно отключена') } : null;
  };
}

