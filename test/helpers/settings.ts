/* A settings store for a test: it answers the keys it is handed and null for every other one, which
 * is what a real store says about a key nobody set and nothing defaults. */
import type { Settings } from '../../src/settings.ts';

export function settingsWith(values: Record<string, unknown>): Pick<Settings, 'get'> {
  return { get: ((key: string) => (key in values ? values[key] : null)) as Settings['get'] };
}
