// A browsing preference, separate from safe mode: it never enables the game patch or any mod.
export type CatalogSource = 'all' | 'official';
let fallback = false;

export function officialOnly(): boolean {
  try { return localStorage.getItem('catalogSource') === 'official'; } catch { return fallback; }
}

export function setCatalogSource(source: CatalogSource): void {
  fallback = source === 'official';
  try { localStorage.setItem('catalogSource', source); } catch { /* storage may be unavailable */ }
}
