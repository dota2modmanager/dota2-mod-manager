import type * as THREE from 'three';
import type { Animation, EffectPatch, SceneManifest } from './studio/index.d.ts';
export interface Hero {
 box:THREE.Box3; heroBox:THREE.Box3; turntable:THREE.Group;
 animations:Animation[]; readonly playing:string; slotMeshes(slot:string):THREE.Mesh[];
 lib:{group:THREE.Group;unsupported:Set<string>};
 studioReplaceParts(changes:{owner:string;source:{manifest:SceneManifest;url:(path:string)=>string}|null}[], current:()=>boolean):Promise<boolean>;
 studioEffects(patch:Partial<EffectPatch>, descriptors?:SceneManifest['materials'], preserveHero?:boolean):Promise<unknown>;
 studioGemEffects(palette:Record<string,{rgb:number[];own:boolean;bake:boolean}>):void;
 studioGemMaterials(colors:Record<string,string>):void;
 /** per material: [hue 0-1, saturation, value, mode 1-4] of the recolour window, or none */
 studioPaintMaterials(paints:Record<string,[number,number,number,number]>|null):void;
 studioEffectsVisible(value:boolean):void;
 update(dt:number,camera:THREE.Camera):void;
}
export class HeroViewer {
 constructor(canvas:HTMLCanvasElement,options?:{assets?:string;controls?:boolean|'hero';wheel?:'zoom'|'turn'|false;framing?:'hero'|'full';pixelRatio?:number;textureScale?:number;bloom?:number|false;softParticles?:boolean;onFrame?:(dt:number)=>void;onAfterUpdate?:()=>void;onAnimation?:(name:string)=>void});
 canvas:HTMLCanvasElement; camera:THREE.PerspectiveCamera; renderer:THREE.WebGLRenderer; scene:THREE.Scene; hero:Hero|null;
 paused:boolean; loading:number; readonly animations:Animation[];
 view:{center:THREE.Vector3;size?:THREE.Vector3;distance:number;zoom:number;zoomTarget:number;pitch:number};
 turn:{angle:number;target:number;velocity:number};
 load(source:{manifest:SceneManifest;url:(path:string)=>string},prepare?:(hero:Hero)=>Promise<void>):Promise<unknown>;
 play(name:string):number; unload():void; fit():void; place():void; frame():void; dispose():void;
}
export function buildHero(manifest:SceneManifest,url:(path:string)=>string,manager:THREE.LoadingManager,time:{value:number},light:Record<string,{value:unknown}>,textureScale?:number):Promise<Hero & {effects:{sim:{particles:{pos:THREE.Vector3;age:number}[];cps:Map<number,{pos:THREE.Vector3}>}}[];dispose():void}>;
