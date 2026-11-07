import { writeGlb } from '../../vendor/dota-loadout/studio/scene-source.mjs';
/** A skinned triangle and a moving hand, no external texture or game assets. */
export function animatedLoadoutModel():Uint8Array{
  const chunks:Uint8Array[]=[],views:{buffer:number;byteOffset:number;byteLength:number}[]=[],accessors:object[]=[];let size=0;
  const add=(values:number[],type:string,count:number,min?:number[],max?:number[])=>{
    const bytes=new Uint8Array(new Float32Array(values).buffer);chunks.push(bytes);views.push({buffer:0,byteOffset:size,byteLength:bytes.length});size+=bytes.length;
    return accessors.push({bufferView:views.length-1,componentType:5126,type,count,...(min?{min,max}:{})})-1;
  };
  const position=add([-.1,1,0,.1,1,0,0,1.2,0],'VEC3',3,[-.1,1,0],[.1,1.2,0]);
  // GLTF joint attributes must be unsigned integers.
  const jointBytes=new Uint8Array(new Uint16Array(12).buffer);chunks.push(jointBytes);views.push({buffer:0,byteOffset:size,byteLength:jointBytes.length});size+=jointBytes.length;
  const joints=accessors.push({bufferView:views.length-1,componentType:5123,type:'VEC4',count:3})-1;
  const weights=add([1,0,0,0,1,0,0,0,1,0,0,0],'VEC4',3);
  const inverse=add([1,0,0,0,0,1,0,0,0,0,1,0,0,-1,0,1],'MAT4',1);
  const times=add([0,1],'SCALAR',2,[0],[1]),moves=add([0,1,0,0,2,0],'VEC3',2);
  const bin=new Uint8Array(size);let at=0;for(const bytes of chunks){bin.set(bytes,at);at+=bytes.length;}
  return writeGlb({json:{asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{name:'hand',translation:[0,1,0]},{name:'triangle',mesh:0,skin:0}],skins:[{joints:[0],inverseBindMatrices:inverse}],meshes:[{primitives:[{attributes:{POSITION:position,JOINTS_0:joints,WEIGHTS_0:weights},material:0}]}],materials:[{name:'native'}],animations:[{name:'idle',channels:[{sampler:0,target:{node:0,path:'translation'}}],samplers:[{input:times,output:moves}]}],accessors,bufferViews:views,buffers:[{byteLength:size}]},bin});
}
