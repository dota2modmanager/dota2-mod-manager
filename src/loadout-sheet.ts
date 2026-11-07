/* VTEX sprite-sheet metadata. Layout: ValveResourceFormat Texture.GetSpriteSheetData (MIT),
 * https://github.com/ValveResourceFormat/ValveResourceFormat . Frame PNGs are exported by VRF. */
import { resourceBlock } from './resource.ts';
import type { LoadoutResources } from '../renderer/api/preview3d.ts';
/** Retain authored sequence IDs and frame durations when VRF exports individual frame PNGs. */
export function loadoutSheet(file:Buffer|null):LoadoutResources['sheets'][string] {
  if(!file)return [];
  try{
    const data=resourceBlock(file,'DATA').data;
    if(data.readUInt16LE(0)!==1)return [];
    const first=32+data.readUInt32LE(32),n=data.readUInt32LE(36);if(n>128)return [];
    for(let i=0;i<n;i++){
      const at=first+i*12;if(data.readUInt32LE(at)!==2)continue;
      const start=at+4+data.readUInt32LE(at+4),size=data.readUInt32LE(at+8),sheet=data.subarray(start,start+size);
      const seqStart=sheet.readInt32LE(0),count=sheet.readUInt32LE(4);if(count>512)return [];
      return Array.from({length:count},(_,s)=>{
        const p=seqStart+s*32,id=sheet.readUInt32LE(p),clamp=!!sheet[p+4],framesAt=p+8+sheet.readInt32LE(p+8),framesCount=sheet.readUInt32LE(p+12);
        if(framesCount>4096||id>1024)throw Error('Sheet frame limit');
        const frames=Array.from({length:framesCount},(_,f)=>{
          const at=framesAt+f*12,time=sheet.readFloatLE(at),img=at+4+sheet.readInt32LE(at+4);
          if(sheet.readUInt32LE(at+8)<1)throw Error('Empty sheet frame');
          const crop=Array.from({length:4},(_,k)=>sheet.readFloatLE(img+k*4));
          const uv=Array.from({length:4},(_,k)=>sheet.readFloatLE(img+16+k*4));
          if(![time,...crop,...uv].every(Number.isFinite))throw Error('Invalid sheet frame');
          return {time,uv,crop};
        });return{id,clamp,frames};
      });
    }
  }catch{ /* A missing sheet is diagnosed by the packet exporter. */ }
  return [];
}
