/* The "Running in the background" switch's one write (renderer/settings/BackgroundBlock.tsx, src/tray.ts). */
export const setRunInBackground = (on: boolean) => window.api.settings.set('runInBackground', on);
