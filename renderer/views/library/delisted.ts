/* Installed catalog mods the catalog has since dropped, or the signed config marks, (catalog/mods.ts delistedFrom), worked out
 * once per catalog the window holds: My mods asks for every row on every draw. */
import { state } from '../../core/store.ts';
import { catalogListing, delistedFrom, type CatalogListing } from '../../catalog/mods.ts';
import { issueOf } from '../../ui/notice.ts';
import type { ModIssue } from '../../api/content.ts';
import type { LibRecord } from '../../library/types.ts';

let seen: unknown = undefined;
let listing: CatalogListing = new Map();

/** Whether the catalog this window holds no longer lists the mod. False until a catalog is loaded. */
export function isDelisted(rec: LibRecord): boolean {
  const data = state.catalog?.mods?.modsData;
  if (!data) return false;
  if (data !== seen) { seen = data; listing = catalogListing(data); }
  return delistedFrom(listing, rec);
}

/** What the signed config says about an installed catalog mod (src/remote-config-format.ts
 * `issues`), or null. A pack is several mods under one name, so it is never matched whole. */
export function configIssue(rec: LibRecord): ModIssue | null {
  if (rec.kind === 'pack' || !rec.categoryId || !rec.name) return null;
  return issueOf(rec.categoryId, rec.name);
}
