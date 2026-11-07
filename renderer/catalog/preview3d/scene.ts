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

export interface HeroScene {
  play:(name:string|null,load?:()=>Promise<Uint8Array|null>,onEnd?:()=>void)=>Promise<boolean>;
  resetView:()=>void; view:()=>StudioView; dispose:()=>void;
  effects:(defs:{part:number;def:ParticleDef}[])=>Promise<void>;
  capture:()=>string;
  suspend:()=>void;
}
export interface SceneOptions {
  signal?:AbortSignal;viewState?:StudioView;still?:boolean;label?:string;clip?:string|null;
  heroModel?:string; stage?:HeroStage;pedestal?:Uint8Array|null;attachments?:{body:Attachment[];parts:Attachment[][]};
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

export async function mountScene(host:HTMLElement,body:Uint8Array,parts:Uint8Array[],options:SceneOptions={}, sharedViewport?:SceneViewport):Promise<HeroScene>{
  const {signal}=options;signal?.throwIfAborted();
  const source = new SceneSource();
  const viewport = sharedViewport ?? createSceneViewport(host, options.label);
  const { canvas, viewer: live } = viewport;
  let disposed=false,loadedMotions=false,request=0,previous='',end:undefined|(()=>void),currentDefs=options.particles??[];
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
      for (const [id, material] of source.materialMetadata) {
        if (material.owner === 'hero' && material.name === 'io_color') source.manifest.materials[id].cloak = 1;
      }
    }
    source.manifest.attachments.hero=loadoutAttachments(options.attachments?.body??[]);
    parts.forEach((part,i)=>{const owner=ownerOf(i);source.addGlb(visibleGlb(part,options.hidden?.parts[i]??[]),{key:owner,owner,itemId:owner});source.manifest.attachments[owner]=loadoutAttachments(options.attachments?.parts[i]??[]);});
    if(!options.isolated){const response=await fetch(new URL('./studio-pedestal.glb',import.meta.url),{signal});if(!response.ok)throw Error('Cannot load local pedestal');const pedestal=new Uint8Array(await response.arrayBuffer());check();source.addGlb(pedestal,{key:'pedestal',owner:'pedestal'});source.manifest.studioPedestal=true;}
    if(options.clip&&source.manifest.animations)source.manifest.animations.idle=options.clip;
    if(options.stage?.background)host.style.setProperty('--stage-tint',`rgb(${options.stage.background.map(x=>Math.round(x*255)).join(',')})`);
    const textures=await loadoutTextures(source,options.sprites??{},options.resources);check();
    let queue:Promise<void>=Promise.resolve();
    const applyEffects=async(defs:{part:number;def:ParticleDef}[])=>{
      check();await live.hero?.studioEffects({});check();source.clearEffects();
      const patch=loadoutEffects(source,defs,textures,options.resources);
      await live.hero?.studioEffects(patch);check();
      const warnings=[...source.warnings,...patch.warnings,...(live.hero?.lib.unsupported??[])];
      options.onWarnings?.([...new Set(warnings)]);
      if(warnings.length)console.warn('3D preview: resource diagnostics',warnings);
    };
    const load=async()=>{
      check();
      await live.load(source.source());check();
      if(options.isolated)live.hero?.turntable.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material]){material.colorWrite=false;material.depthWrite=false;object.castShadow=false;}});
      await applyEffects(currentDefs);check();live.paused=!!options.still;
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
      suspend:()=>{request++;end=undefined;},
      dispose,view:()=>loadoutView(live),resetView:()=>restoreLoadoutView(live,initial),
      capture:()=>{live.frame();return canvas.toDataURL('image/webp',.9);},
      effects(defs){currentDefs=defs;const ticket=++request;queue=queue.catch(()=>{}).then(async()=>{if(ticket===request)await applyEffects(defs);});return queue;},
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
