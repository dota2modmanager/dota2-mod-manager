/* window.api: the bridge preload.js exposes, typed for the window's TypeScript.
 *
 * Every name here is a name in preload.js and the other way round (test/api-types.test.js), and
 * every channel behind them has a handler (test/ipc-contract.test.js). A reply's type is written
 * from its handler in src/ipc-*.js; a change to what a handler answers changes the type beside
 * the others of its group here. */
import type { AppApi } from './app.ts';
import type { ArcanaApi, CatalogApi, ConfigApi, CosmeticsApi, PatchApi, PresetsApi, PreviewApi, ToolsApi } from './content.ts';
import type { ModsApi, PacksApi } from './mods.ts';

export interface Api extends AppApi {
  catalog: CatalogApi;
  mods: ModsApi;
  /** item schema: the search-path patch, the built schema, and the free cosmetics it enables */
  patch: PatchApi;
  /** the Source 2 toolchain: downloaded on request, never behind the user's back */
  tools: ToolsApi;
  /** what the app was told from the network: features switched off, dated notices */
  config: ConfigApi;
  cosmetics: CosmeticsApi;
  /** the arcana built out of the game's own files */
  arcana: ArcanaApi;
  preview: PreviewApi;
  packs: PacksApi;
  presets: PresetsApi;
}
