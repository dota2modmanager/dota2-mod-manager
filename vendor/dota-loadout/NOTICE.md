Dota 2 Mod Manager bundles dota-loadout 0.1.0 by justkiddingxd (MIT).
Upstream: https://github.com/justkiddingxd/dota-loadout
The particle implementation includes MIT-licensed Source 2 Viewer work; see source comments and SOURCE2-VIEWER-LICENSE for its copyright notice and full MIT text.
Local changes in src/viewer.js expose scene updates, effect visibility and host camera updates for the desktop preview; src/material.js retains GLB base color factors. No upstream asset hosting is used by the scene adapter.
Game assets remain the property of Valve and are not supplied by this source package.

The asset pipeline and animation activity ordering were reviewed against upstream commit 3c09d200391cf19db14705dbaca0d6c544dae670. The port additionally preserves native bone aliases, native attachment metadata and additive-clip flags; it supports vertical camera orbit and cancellable cached part downloads.

Follow-up: economy preview control-point configurations take priority; parent entity drivers resolve hero attachments and do not borrow unrelated wearable attachments.

Pedestal support: scales independently to hero height and participates in full-scene framing; meshes with vertex colors retain those colors.

Native-resource follow-up: spritecard channel mixing synced from upstream fx.js at 3c09d200391cf19db14705dbaca0d6c544dae670; rigid snapshot fitting adapted from upstream tools/lib/hero.mjs, with a KD tree for nearest-vertex queries. Host adapter retains native skinning, sprite frame crops, activity modifiers and Dota material metadata. Original MIT notices remain in place.

Hero-scoped particle surface sampling includes the dressed hero and mounts; cached surfaces invalidate when equipped meshes change.
