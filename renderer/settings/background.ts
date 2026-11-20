/* The "Running in the background" switch's one write (renderer/settings/BackgroundBlock.tsx, crates/mm-core/src/app/tray.rs). */
export const setRunInBackground = (on: boolean) => window.api.settings.set('runInBackground', on);
