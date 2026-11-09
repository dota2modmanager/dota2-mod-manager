/* Desktop adapter for the desktop preview's patched dota-loadout. Rendering, simulation, skinning,
 * materials and HDR stay in that library; this module owns IPC data and React lifecycle only. */
import { Mesh, Vector3 } from 'three';
import { HeroViewer } from 'dota-loadout';
import { SceneSource, readGlb } from 'dota-loadout/studio';
import type { Attachment, HeroStage, ParticleDef, LoadoutResources } from '../../api/preview3d.ts';
import type { StudioView } from './studio-settings.ts';
import { loadoutTextures } from './loadout-textures.ts';
import { loadoutAttachments, loadoutEffects, ownerOf, visibleGlb } from './loadout-source.ts';
import { loadoutControls, loadoutView, restoreLoadoutView } from './loadout-controls.ts';
import { loadoutParticleBounds } from './loadout-bounds.ts';

import { loadoutGem, loadoutMaterialGem } from './loadout-gems.ts';
import type { PreviewGem } from '../builder/gems.ts';
import { toHex } from '../arcana/tint.ts';
import { effectPalette, NO_PAINT, scenePaints, type PreviewPaint } from '../paint/preview-paint.ts';

export interface HeroScene {
  play:(name:string|null,load?:()=>Promise<Uint8Array|null>,onEnd?:()=>void)=>Promise<boolean>;
  resetView:()=>void; view:()=>StudioView; dispose:()=>void;
  effects:(defs:{part:number;def:ParticleDef}[])=>Promise<void>;
  gems:(gems:readonly PreviewGem[])=>Promise<void>;
  /** the recolour window's colours, drawn at once */
  paint:(paint:PreviewPaint)=>void;
  capture:()=>string;
  suspend:()=>Promise<void>;
  replace:(body:Uint8Array,parts:Uint8Array[],options:SceneOptions,current:()=>boolean)=>Promise<boolean>;
}
export interface SceneOptions {
  signal?:AbortSignal;viewState?:StudioView;still?:boolean;label?:string;clip?:string|null;
  heroModel?:string; stage?:HeroStage;pedestal?:Uint8Array|null;attachments?:{body:Attachment[];parts:Attachment[][]};
  gems?:readonly PreviewGem[];partSlots?:string[];paint?:PreviewPaint;
  particles?:{part:number;def:ParticleDef}[];sprites?:Record<string,Uint8Array>;resources?:LoadoutResources;
  hidden?:{body:string[];parts:string[][]};isolated?:boolean;onWarnings?:(warnings:string[])=>void;
}

/** A window owns one WebGL context; scene data can be replaced inside it. */
export function createSceneViewport(host: HTMLElement, label = '') {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', label);
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  host.append(canvas);
  const viewport = {
    afterUpdate: () => {},
    viewer: new HeroViewer(canvas, {
      assets: 'file:///unused-local-assets/', controls: true, wheel: 'zoom',
      framing: 'full', textureScale: 1, bloom: .35, softParticles: true,
      onFrame: dt => controls.tick(dt),
      onAfterUpdate: () => viewport.afterUpdate(),
    }),
    canvas,
    dispose() {
      controls.dispose();
      viewport.viewer.dispose();
      canvas.remove();
      host.style.removeProperty('--stage-tint');
    },
  };
  const controls = loadoutControls(viewport.viewer);
  return viewport;
}

export type SceneViewport = ReturnType<typeof createSceneViewport>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.byteLength !== b.byteLength) return false;
  if (a.byteOffset % 4 || b.byteOffset % 4 || a.byteLength % 4) return a.every((byte, i) => byte === b[i]);
  const first = new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const second = new Uint32Array(b.buffer, b.byteOffset, first.length);
  return first.every((word, i) => word === second[i]);
};

export async function mountScene(host:HTMLElement,body:Uint8Array,parts:Uint8Array[],options:SceneOptions={}, sharedViewport?:SceneViewport):Promise<HeroScene>{
  const {signal}=options;signal?.throwIfAborted();
  const source = new SceneSource();
  let textureSource = new SceneSource(), heroTextureSource = textureSource;
  const viewport = sharedViewport ?? createSceneViewport(host, options.label);
  const { canvas, viewer: live } = viewport;
  let disposed=false,loadedMotions=false,request=0,previous='',end:undefined|(()=>void),currentDefs=options.particles??[];
  let currentGems = options.gems ?? [];
  let currentPaint = options.paint ?? NO_PAINT;
  let suspended = false, revision = 0;
  let look = options, wornParts = parts;
  const overrides = new Map<string, SceneSource | null>();
  const weaponOwners = (look: SceneOptions) => look.heroModel === 'models/heroes/terrorblade/terrorblade_arcana.vmdl'
    ? (look.partSlots ?? []).flatMap((slot, i) => slot.endsWith(':weapon') ? [ownerOf(i)] : [])
    : undefined;
  let sourcePaths: Record<string, string> = {};
  const afterUpdate = () => {
    const playing = live.hero?.playing ?? '';
    if (end && previous && playing !== previous) { const done = end; end = undefined; done(); }
    previous = playing;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    request++;
    if (viewport.afterUpdate === afterUpdate) viewport.afterUpdate = () => {};
    if (!sharedViewport) viewport.dispose();
    for (const item of overrides.values()) item?.dispose();
    textureSource.dispose();
    heroTextureSource.dispose();
    source.dispose();
    signal?.removeEventListener('abort', dispose);
  };
  const check=()=>{signal?.throwIfAborted();if(disposed)throw new DOMException('Scene disposed','AbortError');};
  signal?.addEventListener('abort',dispose,{once:true});
  try {
    source.addGlb(visibleGlb(body,options.hidden?.body??[]),{key:'hero',owner:'hero'});
    if (options.heroModel === 'models/heroes/wisp/wisp.vmdl' &&
      options.particles?.some(({ def }) => /\/wisp_ambient\.vpcf$/i.test(def.path))) {
      // Io's native ambient draws the core. Preserve the proxy for bounds and
      // particle surface sampling, but do not render it as opaque geometry.
      for (const materials of [source, ...overrides.values()]) for (const [id, material] of materials?.materialMetadata ?? []) {
        if (material.owner === 'hero' && material.name === 'io_color') source.manifest.materials[id].cloak = 1;
      }
    }
    source.manifest.attachments.hero=loadoutAttachments(options.attachments?.body??[]);
    parts.forEach((part,i)=>{const owner=ownerOf(i);source.addGlb(visibleGlb(part,options.hidden?.parts[i]??[]),{key:owner,owner,itemId:owner});source.manifest.attachments[owner]=loadoutAttachments(options.attachments?.parts[i]??[]);});
    source.manifest.terrorbladeWeaponOwners = weaponOwners(options);
    if(!options.isolated){const response=await fetch(new URL('./studio-pedestal.glb',import.meta.url),{signal});if(!response.ok)throw Error('Cannot load local pedestal');const pedestal=new Uint8Array(await response.arrayBuffer());check();source.addGlb(pedestal,{key:'pedestal',owner:'pedestal'});source.manifest.studioPedestal=true;}
    if(options.clip&&source.manifest.animations)source.manifest.animations.idle=options.clip;
    if(options.stage?.background)host.style.setProperty('--stage-tint',`rgb(${options.stage.background.map(x=>Math.round(x*255)).join(',')})`);
    let textures=await loadoutTextures(textureSource,options.sprites??{},options.resources);check();
    let hasEffectModels = false;
    let queue:Promise<void>=Promise.resolve();
    const tintMaterials = (hero = live.hero) => {
      const colors: Record<string, string> = {};
      for (const materials of [source, ...overrides.values()]) for (const [id, material] of materials?.materialMetadata ?? []) {
        const part = /^part-(\d+)$/.exec(material.owner);
        const gem = loadoutMaterialGem(material.materialPath, part ? look.partSlots?.[Number(part[1])] : undefined, currentGems);
        const descriptor = materials?.manifest.materials[id];
        if (gem && (!gem.stock || descriptor?.detailGem || descriptor?.specGem)) colors[id] = toHex(gem.color);
      }
      hero?.studioGemMaterials(colors);
      hero?.studioPaintMaterials(scenePaints([source, ...overrides.values()].flatMap(m => [...(m?.materialMetadata ?? [])]), look.partSlots ?? [], currentPaint));
      const palette = Object.fromEntries(Object.entries(sourcePaths).flatMap(([id, path]) => {
        const gem = loadoutGem(path, currentGems);
        return gem ? [[id, { rgb: gem.color.map(n => n / 255), own: gem.own, bake: !!gem.bake }]] : [];
      }));
      hero?.studioGemEffects({ ...palette, ...effectPalette(sourcePaths, currentPaint) });
    };
    const applyEffects=async(defs:{part:number;def:ParticleDef}[],hero=live.hero,preserveHero=false)=>{
      check(); source.clearEffects();
      const patch=loadoutEffects(source,defs,textures,look.resources);
      const hadModels = hasEffectModels;
      hasEffectModels = Object.keys(patch.fxModels).length > 0;
      const retained = preserveHero && !hadModels && !hasEffectModels;
      await hero?.studioEffects(patch, source.manifest.materials, retained);check();
      sourcePaths = patch.sourcePaths;
      tintMaterials(hero);
      const warnings=[...source.warnings,...patch.warnings,...(hero?.lib.unsupported??[])];
      options.onWarnings?.([...new Set(warnings)]);
      if(warnings.length)console.warn('3D preview: resource diagnostics',warnings);
      return retained;
    };
    const load=async()=>{
      check();
      const manifest = { ...source.manifest, models: { ...source.manifest.models }, attachments: { ...source.manifest.attachments }, materials: { ...source.manifest.materials }, terrorbladeWeaponOwners: weaponOwners(look) };
      for (const [owner, item] of overrides) {
        if (!item) { delete manifest.models[owner]; delete manifest.attachments[owner]; continue; }
        manifest.models[owner] = item.url(item.manifest.models[owner]);
        manifest.attachments[owner] = item.manifest.attachments[owner];
        Object.assign(manifest.materials, item.manifest.materials);
      }
      const address = (path: string) => {
        for (const item of overrides.values()) if (item?.files.has(path)) return item.url(path);
        return source.url(path);
      };
      await live.load({ manifest, url: address }, async hero => {
        if(options.isolated)hero.turntable.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material]){material.colorWrite=false;material.depthWrite=false;object.castShadow=false;}});
        await applyEffects(currentDefs, hero);
      });
      if (heroTextureSource !== textureSource) { heroTextureSource.dispose(); heroTextureSource = textureSource; }
      check();live.paused=!!options.still;
    };
    await load();
    if(options.isolated&&live.hero){
      for(let i=0;i<90;i++)live.hero.update(1/60,live.camera);
      const box=loadoutParticleBounds(live.hero.lib.group);
      if(!box.isEmpty()&&box.getSize(new Vector3()).length()<500){live.view.center.copy(box.getCenter(new Vector3()));live.view.size=box.getSize(new Vector3()).max(new Vector3(1,1,1));live.place();}
      await applyEffects(currentDefs);
    }
    const initial=loadoutView(live);if(options.viewState)restoreLoadoutView(live,options.viewState);
    viewport.afterUpdate = afterUpdate;
    return{
      async replace(nextBody, nextParts, next, current) {
        const hero = live.hero;
        if (!hero || suspended || options.isolated || next.heroModel !== look.heroModel || next.clip !== look.clip ||
          next.still !== look.still || !same(next.stage, look.stage) || !same(next.hidden?.body, look.hidden?.body) ||
          !same(next.attachments?.body, look.attachments?.body) || !sameBytes(body, nextBody)) return false;
        const changes: {owner:string;source:SceneSource|null}[] = [];
        for (let i = 0; i < Math.max(wornParts.length, nextParts.length); i++) {
          const old = wornParts[i], updated = nextParts[i];
          if (old && updated && sameBytes(old, updated) && same(look.hidden?.parts[i], next.hidden?.parts[i]) &&
            same(look.attachments?.parts[i], next.attachments?.parts[i]) && look.partSlots?.[i] === next.partSlots?.[i]) continue;
          if (old && readGlb(old).json.animations?.length || updated && readGlb(updated).json.animations?.length) return false;
          changes.push({owner:ownerOf(i),source:null});
        }
        const nextTextureSource = new SceneSource();
        try {
          const nextTextures = await loadoutTextures(nextTextureSource, next.sprites ?? {}, next.resources);
          check();
          if (!current()) return false;
          for (const change of changes) {
            const index = Number(change.owner.slice(5)), bytes = nextParts[index];
            if (!bytes) continue;
            const item = change.source = new SceneSource();
            item.addGlb(visibleGlb(bytes, next.hidden?.parts[index] ?? []), {key:'wear-' + ++revision, owner:change.owner});
            item.manifest.attachments[change.owner] = loadoutAttachments(next.attachments?.parts[index] ?? []);
            item.manifest.terrorbladeWeaponOwners = weaponOwners(next);
          }
          if (!await hero.studioReplaceParts(changes.map(change => ({owner:change.owner,source:change.source?.source() ?? null})), () => current() && live.hero === hero)) return false;
          for (const change of changes) {
            overrides.get(change.owner)?.dispose();
            overrides.set(change.owner, change.source);
          }
          wornParts = nextParts;
          look = next;
          textures = nextTextures;
          const nextDefs = next.particles ?? [];
          const preserveHero = same(currentDefs.filter(row => row.part < 0), nextDefs.filter(row => row.part < 0));
          currentDefs = nextDefs;
          const previousTextures = textureSource;
          textureSource = nextTextureSource;
          if (!await applyEffects(currentDefs, hero, preserveHero)) {
            heroTextureSource.dispose();
            heroTextureSource = textureSource;
          }
          if (previousTextures !== heroTextureSource) previousTextures.dispose();
          return true;
        } finally {
          if (textureSource !== nextTextureSource) nextTextureSource.dispose();
          for (const change of changes) if (overrides.get(change.owner) !== change.source) change.source?.dispose();
        }
      },
      suspend:async()=>{suspended=true;request++;end=undefined;await queue.catch(()=>{});},
      dispose,view:()=>loadoutView(live),resetView:()=>restoreLoadoutView(live,initial),
      capture:()=>{live.frame();return canvas.toDataURL('image/webp',.9);},
      effects(defs){currentDefs=defs;const ticket=++request;queue=queue.catch(()=>{}).then(async()=>{if(ticket===request)await applyEffects(defs);});return queue;},
      paint(paint) {
        currentPaint = paint;
        if (!disposed && !suspended) tintMaterials();
      },
      gems(gems) {
        if (suspended) return Promise.resolve();
        currentGems = gems;
        if (!disposed) tintMaterials();
        return Promise.resolve();
      },
      async play(name,fetchMotions,onEnd){
        const ticket=++request;end=undefined;const chosen=name??source.manifest.animations?.idle??'';
        if(!live.animations.some(a=>a.name===chosen)&&!loadedMotions&&fetchMotions){
          const bytes=await fetchMotions();check();if(ticket!==request||!bytes)return false;
          const view=loadoutView(live);source.addGlb(bytes,{key:'animations',owner:'animation-source'});
          const list=source.manifest.animations?.list??[];
          for(const animation of readGlb(bytes).json.animations??[])if(animation.name&&!list.some(a=>a.name===animation.name))list.push({name:animation.name,loop:/idle|walk|run|loadout/i.test(animation.name)});
          source.manifest.animations={...source.manifest.animations,list};loadedMotions=true;await load();check();if(ticket!==request)return false;restoreLoadoutView(live,view);
        }
        if(!live.animations.some(a=>a.name===chosen))return false;
        live.play(chosen);previous=live.hero?.playing??chosen;end=onEnd;return true;
      },
    };
  }catch(error){dispose();throw error;}
}
