import type { LoadoutResources } from '../../api/preview3d.ts';
import type { SceneSource } from 'dota-loadout/studio';

type Frame={time:number;uv:number[];crop?:number[]};
export interface PacketTexture { url:string; sequences?:{clamp:boolean;frames:Frame[]}[] }

/** VRF's individual PNG frames become one atlas, with the game's sequence ids and timings.
 * Passing only the largest frame makes animated blades look like stationary glowing dots. */
export async function loadoutTextures(source:SceneSource,bytes:Record<string,Uint8Array>,resources?:LoadoutResources):Promise<Record<string,PacketTexture>>{
  const out:Record<string,PacketTexture>={};
  for(const [path,data] of Object.entries(bytes)){
    if(path.includes('#seq='))continue;
    const entries=Object.entries(bytes).flatMap(([key,value])=>{
      if(!key.startsWith(path+'#seq='))return [];
      const m=/#seq=(\d+)&frame=(\d+)$/.exec(key);return m?[{seq:Number(m[1]),frame:Number(m[2]),bytes:value}]:[];
    });
    if(!entries.length){out[path]={url:source.blob(data,'image/png')};continue;}
    const images:ImageBitmap[]=[];
    try{
      for(const item of entries)images.push(await createImageBitmap(new Blob([item.bytes.slice().buffer],{type:'image/png'})));
      const width=Math.max(...images.map(i=>i.width)),height=Math.max(...images.map(i=>i.height));
      const columns=Math.ceil(Math.sqrt(entries.length)),rows=Math.ceil(entries.length/columns),scale=Math.min(1,4096/(columns*(width+2)),4096/(rows*(height+2)));
      const w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale)),cw=w+2,ch=h+2;
      const canvas=document.createElement('canvas');canvas.width=columns*cw;canvas.height=rows*ch;
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Cannot create sprite atlas');
      const sequences:NonNullable<PacketTexture['sequences']>=[];
      entries.forEach((_,i)=>{
        const x=i%columns*cw+1,y=Math.floor(i/columns)*ch+1;
        ctx.drawImage(images[i],x,y,Math.max(1,Math.round(images[i].width*scale)),Math.max(1,Math.round(images[i].height*scale)));
      });
      const sheets=resources?.sheets[path]??[];
      const put=(id:number,frameIndex:number,index:number,clamp:boolean,time:number)=>{
        const x=index%columns*cw+1,y=Math.floor(index/columns)*ch+1,iw=Math.max(1,Math.round(images[index].width*scale)),ih=Math.max(1,Math.round(images[index].height*scale));
        const sequence=sequences[id]??={clamp,frames:[]};
        sequence.frames[frameIndex]={time:time>0?time:1/30,uv:[x/canvas.width,y/canvas.height,(x+iw)/canvas.width,(y+ih)/canvas.height]};
      };
      if(sheets.length)sheets.forEach((sequence,seqIndex)=>sequence.frames.forEach((frame,frameIndex)=>{
        // VRF names PNGs by table index; the particle selects the authored sequence id.
        let index=entries.findIndex(e=>e.seq===seqIndex&&e.frame===frameIndex);
        if(index<0)index=entries.findIndex(e=>{const other=sheets[e.seq]?.frames[e.frame];return other&&JSON.stringify([other.uv,other.crop])===JSON.stringify([frame.uv,frame.crop]);});
        if(index<0){source.warnings.push(`Missing sprite frame: ${path} sequence ${sequence.id} frame ${frameIndex}`);return;}
        // VRF reconstructs each frame's uncropped image including transparent margins.
        // Sampling the entire new tile preserves that geometry; applying crop again shrinks it twice.
        put(sequence.id,frameIndex,index,sequence.clamp,frame.time);
      }));
      else entries.forEach((entry,i)=>put(entry.seq,entry.frame,i,false,1/30));
      for(let i=0;i<sequences.length;i++){
        sequences[i]??={clamp:true,frames:[]};
        const frames=sequences[i].frames;
        for(let f=0;f<frames.length;f++)if(!frames[f])frames[f]=frames.find(Boolean)??{time:1/30,uv:[0,0,0,0]};
      }
      out[path]={url:canvas.toDataURL('image/png'),sequences};
    }finally{images.forEach(image=>image.close());}
  }
  return out;
}
