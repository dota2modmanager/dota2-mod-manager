/**
 * Where the catalog's mods get downloaded, counted at build time.
 *
 * The numbers are the Dota2PornFx catalog's own download counter (its stats page reads the same
 * two files). They count downloads of catalog mods by country and by city, with no person in
 * them: a city and a total is all either file holds. The counter's CORS answer is `null`, so a
 * browser on this domain could not read it anyway; the build reads it once and the page is
 * static, which also means a visitor's browser never talks to the counter.
 *
 * An offline build falls back to the snapshot in src/data/geo-fallback.json, which the page
 * dates, the same way src/lib/stats.ts falls back for the landing's numbers.
 */
import fallback from '../data/geo-fallback.json';

const COUNTER = 'https://d2pfx-counter.hrdqfck.workers.dev';
const UA = { 'User-Agent': 'dota2modmanager-site' };

export interface City {
  country: string;
  name: string;
  lat: number;
  lon: number;
  downloads: number;
}

export interface Geo {
  /** ISO 3166 alpha-2 code -> downloads, biggest first. */
  countries: [string, number][];
  /** Biggest first. */
  cities: City[];
  /** Downloads the counter could place in a country. */
  total: number;
  /** YYYY-MM-DD the snapshot was taken, or null when the build read the counter live. */
  snapshot: string | null;
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Keeps only what the page can draw: two-letter codes, real coordinates, positive counts. */
export function shape(countries: unknown, cities: unknown, snapshot: string | null): Geo {
  const byCountry = Object.entries(countries && typeof countries === 'object' ? countries : {})
    .filter(([code]) => /^[A-Z]{2}$/.test(code))
    .map(([code, n]) => [code, count(n)] as [string, number])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const list = (Array.isArray(cities) ? cities : [])
    .filter((c): c is [string, string, number, number, number] => Array.isArray(c) && c.length >= 5)
    .map(([country, name, lat, lon, n]) => ({ country: String(country), name: String(name), lat: Number(lat), lon: Number(lon), downloads: count(n) }))
    .filter((c) => c.downloads > 0 && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && c.name.trim() !== '')
    .sort((a, b) => b.downloads - a.downloads);
  return { countries: byCountry, cities: list, total: byCountry.reduce((n, [, d]) => n + d, 0), snapshot };
}

async function read(file: string) {
  const res = await fetch(`${COUNTER}/${file}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${file} ${res.status}`);
  return res.json();
}

let pending: Promise<Geo> | null = null;

/** Both language pages ask for this, so the counter is read once per build. */
export function downloadsGeo(): Promise<Geo> {
  pending ??= (async () => {
    try {
      const [countries, cities] = await Promise.all([read('geo.json'), read('cities.json')]);
      const geo = shape(countries, cities, null);
      if (!geo.total || !geo.cities.length) throw new Error('counted nothing');
      return geo;
    } catch (err) {
      console.warn(`geo: using the committed snapshot (${(err as Error).message})`);
      return shape(fallback.countries, fallback.cities, fallback.counted);
    }
  })();
  return pending;
}
