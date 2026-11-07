// A hero in an outfit, as the site shows him: his items by slot with their styles, the hero's form
// they ask for (an arcana's, a persona's), prismatic gems, unusual effects and kinetic gems — read
// from the built catalogs (heroes/<id>/items.json) and the site's addresses.
//
//   const look = new Loadout(viewer);                       // assets: the viewer's (loadout.nyan.cafe)
//   await look.show('#terrorblade/hero_base=5957~gold,weapon=12917');
//   await look.show('juggernaut', { weapon: 6058, head: [7413, 1] });
//   look.address                                             // '#juggernaut/weapon=6058,head=7413.1'

// An address: #hero/slot=item.style~gem!unusual^kinetic,… (the site's; the # may be left out).
export function parseLoadout(address) {
  const [id, rest = ''] = decodeURIComponent(String(address).replace(/^#/, '')).split('/'), worn = {}, gems = {}, unusual = {}, kinetic = {};
  for (const part of rest.split(',')) {
    const m = /^(\w+)=(\d+)(?:\.(\d+))?(?:~(\w+))?(?:!(\d+))?(?:\^(\d+))?$/.exec(part); if (!m) continue;
    worn[m[1]] = [+m[2], +(m[3] || 0)]; if (m[4]) gems[m[1]] = m[4]; if (m[5]) unusual[m[1]] = +m[5]; if (m[6]) kinetic[m[1]] = +m[6];
  }
  return { hero: id || null, worn, gems, unusual, kinetic };
}
export function formatLoadout({ hero, worn = {}, gems = {}, unusual = {}, kinetic = {} }) {
  const parts = Object.entries(worn).filter(([, w]) => w).map(([slot, w]) => { const [id, style = 0] = [].concat(w);
    return `${slot}=${id}${style ? `.${style}` : ''}${gems[slot] ? `~${gems[slot]}` : ''}${unusual[slot] ? `!${unusual[slot]}` : ''}${kinetic[slot] != null ? `^${kinetic[slot]}` : ''}`; });
  return `#${hero}${parts.length ? `/${parts.join(',')}` : ''}`;
}

const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });

export class Loadout {
  // viewer: a HeroViewer; options.assets: where the heroes, items and gems are (the viewer's by default).
  constructor(viewer, options = {}) {
    this.viewer = viewer; this.assets = options.assets ?? viewer.assets;
    this.catalogs = new Map(); this.hero = null; this.catalog = null; this.form = null; this.loaded = null;
    this.worn = {}; this.gems = {}; this.unusual = {}; this.kinetic = {}; this.palette = null;
  }
  url(path) { return new URL(path, this.assets).href; }
  // The heroes there are (heroes/index.json): id, name, attribute, animations…
  async heroes() { return (this.index ||= await json(this.url('heroes/index.json'))).heroes; }
  // A hero's catalog: his slots and items with their rarities, styles, sets.
  async catalogOf(hero) { if (!this.catalogs.has(hero)) this.catalogs.set(hero, json(this.url(`heroes/${hero}/items.json`)).catch(() => ({ slots: [], items: {}, sets: [] }))); return this.catalogs.get(hero); }
  // The prismatic gems' colours (gems.json): [{ key, hex, name }].
  async gemColours() { return (this.palette ||= (await json(this.url('gems.json')).catch(() => ({ prismatic: [] }))).prismatic); }

  // Shows a hero — an address, or his id with what he wears ({ slot: id | [id, style] }) and
  // { gems, unusual, kinetic } by slot — in the form his items ask for; resolves once all is on.
  async show(hero, worn = {}, extras = {}) {
    let asked = typeof hero === 'string' && (hero.startsWith('#') || hero.includes('/')) ? parseLoadout(hero) : { hero, worn: Object.fromEntries(Object.entries(worn).map(([s, w]) => [s, [].concat(w)])), gems: extras.gems || {}, unusual: extras.unusual || {}, kinetic: extras.kinetic || {} };
    const ticket = (this.ticket = (this.ticket || 0) + 1);
    const catalog = await this.catalogOf(asked.hero); if (ticket !== this.ticket) return this;
    this.hero = asked.hero; this.catalog = catalog; this.worn = this.valid(asked.worn);
    const moved = (o) => Object.fromEntries(Object.entries(o).map(([slot, v]) => [this.slotNow(asked.worn, slot), v]).filter(([slot]) => this.worn[slot]));
    this.gems = moved(asked.gems); this.unusual = moved(asked.unusual); this.kinetic = moved(asked.kinetic);
    await this.reload(ticket);
    return this;
  }
  // The address of what is shown (for the site: https://loadout.nyan.cafe/ + it).
  get address() { return this.hero ? formatLoadout(this) : ''; }

  // Puts an item on a slot (null: its default), in a style; the hero changes form when it asks.
  async wear(slot, id, style = 0) {
    const it = id != null && this.catalog?.items[id];
    if (this.worn[slot]?.[0] !== id) { delete this.gems[slot]; delete this.unusual[slot]; delete this.kinetic[slot]; this.viewer.gem(slot, null); this.viewer.unusual(slot, null); this.viewer.kinetic(slot, null); }
    this.worn[slot] = it && !it.default ? [+id, style] : null;
    if (this.formOf(this.worn) !== this.form) return this.reload();
    await this.viewer.wear(slot, this.worn[slot] ? this.url(`items/${id}/`) : null, style);
    await this.apply(slot);
  }
  // A prismatic gem (gems.json's key) in a slot's item, if it takes one; null for the one it comes with.
  async gem(slot, key) { const own = this.socketed(slot); if (key && this.takesGem(slot) && key !== own) this.gems[slot] = key; else delete this.gems[slot]; await this.apply(slot); }
  // An unusual effect (an id of the item's list) on a slot's item, or null.
  unusual(slot, id) { if (id != null && this.unusualsOf(slot).some((u) => u.id === id)) this.unusual[slot] = id; else delete this.unusual[slot]; this.viewer.unusual(slot, this.unusual[slot] ?? null); }
  // A kinetic gem (an id of the hero's list, this.kinetics) in a slot's item, or null.
  kineticGem(slot, id) { const k = this.kinetics.find((x) => x.id === id); if (k && this.worn[slot]) this.kinetic[slot] = id; else delete this.kinetic[slot]; this.viewer.kinetic(slot, k?.activities || null); }
  // The kinetic gems of the hero shown (with the activities each changes).
  get kinetics() { return this.loaded?.kinetic || []; }

  // ---- the catalog's rules (as the site has them)
  // Forms: a worn style may put the hero in another model of his (a persona's number, an arcana's).
  formsOf(worn) { return Object.entries(worn).filter(([, w]) => w).map(([slot, [id, style]]) => { const it = this.catalog?.items[id]; return { slot, form: (it?.styles[style] || it?.styles[0])?.form }; }).filter((x) => x.form); }
  personaOf(worn) { return +(/^persona(\d+)$/.exec(this.formsOf(worn).find((x) => x.form.startsWith('persona'))?.form || '')?.[1] || 0); }
  formOf(worn) {
    const forms = this.formsOf(worn), p = this.personaOf(worn), own = (slot) => +(/_persona_(\d+)$/.exec(slot)?.[1] || 0);
    return forms.find((x) => p && own(x.slot) === p)?.form || (p ? `persona${p}` : forms.find((x) => !own(x.slot))?.form) || null;
  }
  // A slot dresses the hero as he is (a persona's slots only in it, his own only out of it).
  applies(slot) { const s = this.catalog?.slots.find((x) => x.name === slot), p = this.personaOf(this.worn); return !!s && (s.persona ? s.persona === p : !p || slot === 'persona_selector'); }
  // What an address names that the catalog has: an item the game moved goes to its slot now, and its
  // set's item takes the slot it left (Terrorblade's arcana: once his head, now his base and horns).
  valid(worn) {
    const c = this.catalog, out = {};
    for (const [, w] of Object.entries(worn)) { const it = c?.items[w[0]]; if (it && !it.default) out[it.slot] = [+w[0], w[1] || 0]; }
    for (const [slot, w] of Object.entries(worn)) {
      const it = c?.items[w[0]]; if (!it || it.default || it.slot === slot || out[slot] || !it.set) continue;
      const mate = Object.entries(c.items).find(([, x]) => x.set === it.set && x.slot === slot && !x.default); if (mate) out[slot] = [+mate[0], 0];
    }
    return out;
  }
  slotNow(worn, slot) { return this.catalog?.items[worn[slot]?.[0]]?.slot || slot; }
  takesGem(slot) { const it = this.catalog?.items[this.worn[slot]?.[0]]; return !!(it && !it.default && it.prismatic); }
  socketed(slot) { const it = this.catalog?.items[this.worn[slot]?.[0]]; return typeof it?.prismatic === 'string' ? it.prismatic : null; }
  unusualsOf(slot) { const it = this.catalog?.items[this.worn[slot]?.[0]]; return (it && !it.default && it.unusual) || []; }

  // ---- loading
  async reload(ticket = (this.ticket = (this.ticket || 0) + 1)) {
    this.form = this.formOf(this.worn);
    const loaded = await this.viewer.load(this.url(`heroes/${this.hero}/${this.form ? `forms/${this.form}/` : ''}`));
    if (ticket !== this.ticket || !loaded) return;
    this.loaded = loaded;
    await Promise.all(Object.entries(this.worn).filter(([slot, w]) => w && this.applies(slot)).map(([slot, [id, style]]) => this.viewer.wear(slot, this.url(`items/${id}/`), style).catch(() => {})));
    if (ticket !== this.ticket) return;
    for (const slot of Object.keys(this.worn)) await this.apply(slot);
  }
  // A slot's gem, unusual effect and kinetic gem onto the viewer.
  async apply(slot) {
    if (!this.worn[slot] || !this.applies(slot)) return;
    const key = this.gems[slot] || this.socketed(slot);
    if (this.takesGem(slot) && key) { const hex = (await this.gemColours()).find((g) => g.key === key)?.hex || null; this.viewer.gem(slot, hex); }
    if (this.unusual[slot] != null && this.unusualsOf(slot).some((u) => u.id === this.unusual[slot])) this.viewer.unusual(slot, this.unusual[slot]);
    const k = this.kinetics.find((x) => x.id === this.kinetic[slot]); if (k) this.viewer.kinetic(slot, k.activities);
  }
}
