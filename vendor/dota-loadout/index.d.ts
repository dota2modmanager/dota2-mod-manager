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
 constructor(canvas:HTMLCanvasElement,options?:{assets?:string;controls?:boolean|'hero';wheel?:'zoom'|'turn'|false;framing?:'hero'|'full';pixelRatio?:number;textureScale?:number;bloom?:number|false;softParticles?:boolean;onFrame?:(dt:number)=>void;onAfterUpdate?:()=>void;onAnimation?:(name:string)=>void;beforeShow?:()=>Promise<void>});
 canvas:HTMLCanvasElement; camera:THREE.PerspectiveCamera; renderer:THREE.WebGLRenderer; scene:THREE.Scene; hero:Hero|null;
 paused:boolean; loading:number; readonly animations:Animation[];
 view:{center:THREE.Vector3;size?:THREE.Vector3;distance:number;zoom:number;zoomTarget:number;pitch:number};
 turn:{angle:number;target:number;velocity:number};
 load(source:{manifest:SceneManifest;url:(path:string)=>string},prepare?:(hero:Hero)=>Promise<void>):Promise<unknown>;
 play(name:string):number; unload():void; park():void; fit():void; place():void; frame():void; dispose():void;
}
export function buildHero(manifest:SceneManifest,url:(path:string)=>string,manager:THREE.LoadingManager,time:{value:number},light:Record<string,{value:unknown}>,textureScale?:number,warm?:((objects:THREE.Object3D[])=>Promise<void>)|null):Promise<Hero & {effects:{sim:{particles:{pos:THREE.Vector3;age:number}[];cps:Map<number,{pos:THREE.Vector3}>}}[];dispose():void}>;
/** The game's axes and inches to the scene's: Y up, metres. */
export const SOURCE_TO_GLTF: THREE.Matrix4;
/** A control point of a system: where it is and how it is turned. */
export interface ControlPoint { pos: THREE.Vector3; quat: THREE.Quaternion; matrix(): THREE.Matrix4 }
/** The systems, textures and snapshots a simulation reads, and the group its meshes are drawn in. */
export class Library {
 constructor(options:{systems:Record<string,unknown>;textures:Record<string,unknown>;snapshots:Record<string,unknown>;url:(file:string)=>string;models?:unknown;options?:{onTexture?:(t:THREE.Texture)=>void;refract?:boolean;distanceFade?:boolean}});
 group:THREE.Group; unsupported:Set<string>;
 system(path:string):Record<string,unknown>|null;
 dispose():void;
}
/** One particle system played: its control points set, then stepped and drawn each frame. */
export class Simulation {
 constructor(def:Record<string,unknown>, lib:Library);
 cps:Map<number,ControlPoint>;
 def:Record<string,unknown>;
 update(dt:number):void;
 render(camera:THREE.Camera, groupInverse:THREE.Matrix4):void;
 count():number;
 /** this system and its children, depth first */
 all():IterableIterator<Simulation>;
 stopEmission():void;
 dispose():void;
}
