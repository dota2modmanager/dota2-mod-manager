import type { Object3D } from 'three';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface NativeAttachment { bones: string[]; offsets: number[][]; rotations: number[][]; weights: number[]; ignoreRotation: boolean }
export interface Animation { name: string; loop?: boolean; activity?: string; modifiers?: string[]; additive?: boolean; duration?: number }
export interface TextureInfo { file: string; sequences?: { clamp: boolean; frames: { time: number; uv: number[]; crop?: number[] }[] }[] }
export interface SceneManifest {
 id: string; name: { en: string }; models: Record<string,string>; materials: Record<string,Record<string,unknown>>;
 attachments: Record<string,Record<string,NativeAttachment>>; studioPedestal?: boolean;
 animations?: { list: Animation[]; idle?: string; variants?: Animation[]; defaults?: Record<string,unknown[]> };
 [key: string]: unknown;
}
export interface EffectPacket { root: string; definitions: Record<string,Record<string,Json>>; textures?: Record<string,unknown>; snapshots?: Record<string,unknown>; materials?: Record<string,unknown>; models?: Record<string,unknown>; missing?: string[] }
export interface EffectEntry { namespace?:string; packet: EffectPacket; itemId?: string; scope?: string; effectId?: string; color?: number[] }
export interface EffectPatch { sourcePaths: Record<string,string>; systems: Record<string,Record<string,Json>>; textures: Record<string,TextureInfo>; snapshots: Record<string,unknown>; effects: { system:string; owner:string; color:number[]|null }[]; fxModels: Record<string,unknown>; materials: Record<string,unknown>; warnings: string[] }
export class SceneSource {
 constructor(options?: { createUrl?: (blob:Blob)=>string; revokeUrl?: (url:string)=>void });
 manifest: SceneManifest; files: Map<string,string>; owners: Map<string,string>; urls: Set<string>; warnings: string[];
 modelMetadata: Map<string,unknown>; materialMetadata: Map<string,{name:string;materialPath:string;owner:string;itemId:string|null}>;
 blob(bytes:Uint8Array,mime:string):string;
 addGlb(bytes:Uint8Array, options:{key:string;owner?:string;itemId?:string;register?:boolean;model?:string}):string;
 url:(path:string)=>string;
 source(): {manifest:SceneManifest;url:(path:string)=>string};
 applyMetadata(results:unknown, preferred?:string[]):void;
 clearEffects():void; dispose():void;
}
export function effectSource(source:SceneSource,entries:EffectEntry[],options?:{glow?:string|null}):EffectPatch;
export function readGlb(bytes:Uint8Array):{json:Record<string,any>;bin:Uint8Array;extra:{type:number;bytes:Uint8Array}[]};
export function writeGlb(value:{json:Record<string,any>;bin:Uint8Array;extra?:{type:number;bytes:Uint8Array}[]}):Uint8Array;
export function normalizeAttachment(row:unknown):NativeAttachment|null;
