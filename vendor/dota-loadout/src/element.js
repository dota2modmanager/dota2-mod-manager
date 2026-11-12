// <dota-hero>: a hero on a page with no code of one's own.
//
//   <script type="module">import 'dota-loadout/element';</script>
//   <dota-hero hero="juggernaut" style="width: 480px; height: 640px"></dota-hero>
//   <dota-hero loadout="#terrorblade/hero_base=5957~gold,weapon=12917" animation="loadout"></dota-hero>
//
// Attributes: hero (an id), loadout (a site address: hero, items, gems), animation (a name of the
// hero's to play), assets (where heroes and items are; loadout.nyan.cafe by default), controls
// ("true", "hero" or "false"), wheel ("zoom", "turn" or "false"), bloom (a strength, or "false").
// The element's viewer and loadout: element.viewer, element.loadout.
import { Loadout } from './loadout.js';
import { HeroViewer } from './viewer.js';

const flag = (v, d) => (v == null ? d : v === 'false' ? false : v === 'true' ? true : v);

export class DotaHero extends HTMLElement {
  static observedAttributes = ['hero', 'loadout', 'animation'];
  connectedCallback() {
    if (this.viewer) return;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{display:block;position:relative;min-height:200px}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}</style><canvas></canvas>';
    const bloom = flag(this.getAttribute('bloom'), undefined);
    this.viewer = new HeroViewer(root.querySelector('canvas'), {
      controls: flag(this.getAttribute('controls'), true), wheel: flag(this.getAttribute('wheel'), 'zoom'),
      ...(this.hasAttribute('assets') ? { assets: new URL(this.getAttribute('assets'), document.baseURI).href } : {}),
      ...(bloom !== undefined ? { bloom: bloom === false ? false : +bloom } : {}),
      onProgress: (loaded, total) => this.dispatchEvent(new CustomEvent('progress', { detail: { loaded, total } })),
    });
    this.loadout = new Loadout(this.viewer);
    this.update();
  }
  disconnectedCallback() { this.viewer?.dispose(); this.viewer = null; }
  attributeChangedCallback() { if (this.viewer) this.update(); }
  async update() {
    const address = this.getAttribute('loadout'), hero = this.getAttribute('hero');
    const key = `${address}|${hero}`; if (key !== this.shown) { this.shown = key; if (address || hero) await this.loadout.show(address || hero); this.dispatchEvent(new Event('load')); }
    const animation = this.getAttribute('animation'); if (animation && this.viewer.animations.some((a) => a.name === animation)) this.viewer.play(animation);
  }
}
if (!customElements.get('dota-hero')) customElements.define('dota-hero', DotaHero);
