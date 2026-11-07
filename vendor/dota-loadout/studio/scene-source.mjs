import {calibratePreviewMaterial} from './material-calibration.mjs';
import {enableDarkBlend,forceParticleColor} from './recolor.mjs';
import {normalizeSnapshot} from './snapshot-data.mjs';
import {sceneAnimations,sourceModel} from './scene-animations.mjs';
const enc=new TextEncoder(),dec=new TextDecoder();
const compiled=p=>String(p??'').replace(/_c$/,'');
const systemKey=p=>compiled(p).replace(/\.vpcf$/,'');
const finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
export function readGlb(bytes){
 const array=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),view=new DataView(array.buffer,array.byteOffset,array.byteLength);
 if(array.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==array.length)throw Error('Invalid GLB');
 let json,bin=new Uint8Array();const extra=[];for(let at=12;at<array.length;){if(at+8>array.length)throw Error('Truncated GLB chunk');const length=view.getUint32(at,true),type=view.getUint32(at+4,true);at+=8;if(at+length>array.length)throw Error('Truncated GLB payload');const chunk=array.subarray(at,at+length);if(type===0x4e4f534a)json=JSON.parse(dec.decode(chunk).replace(/[\u0000 ]+$/,''));else if(type===0x004e4942)bin=chunk;else extra.push({type,bytes:chunk});at+=length;}if(!json)throw Error('GLB JSON missing');return{json,bin,extra};
}
export function writeGlb({json,bin,extra=[]}){
 let text=enc.encode(JSON.stringify(json)),pad=(4-text.length%4)%4,j=new Uint8Array(text.length+pad);j.fill(32);j.set(text);const chunks=[{type:0x4e4f534a,bytes:j},...(bin.length?[{type:0x004e4942,bytes:bin}]:[]),...extra];const size=12+chunks.reduce((n,c)=>n+8+c.bytes.length,0),out=new Uint8Array(size),v=new DataView(out.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,size,true);let at=12;for(const c of chunks){v.setUint32(at,c.bytes.length,true);v.setUint32(at+4,c.type,true);out.set(c.bytes,at+8);at+=8+c.bytes.length;}return out;
}
const rgba=c=>Array.from(c??[1,1,1,1],v=>finite(v,1));
export function normalizeAttachment(row){const v=row?.value??row,k=Math.max(1,Math.min(4,Number(v?.m_nInfluences??v?.bones?.length??1)));if(!v)return null;const bones=(v.bones??v.m_influenceNames??[]).slice(0,k);if(!bones.length)return null;return{bones,offsets:(v.offsets??v.m_vInfluenceOffsets??bones.map(()=>[0,0,0])).slice(0,k),rotations:(v.rotations??v.m_vInfluenceRotations??bones.map(()=>[0,0,0,1])).slice(0,k),weights:(v.weights??v.m_influenceWeights??bones.map((_,i)=>i?0:1)).slice(0,k),ignoreRotation:!!(v.ignoreRotation??v.m_bIgnoreRotation)};}
export class SceneSource {
 constructor({createUrl=b=>URL.createObjectURL(b),revokeUrl=u=>URL.revokeObjectURL(u)}={}){this.createUrl=createUrl;this.revokeUrl=revokeUrl;this.urls=new Set();this.files=new Map();this.owners=new Map();this.materialMetadata=new Map();this.modelMetadata=new Map();this.warnings=[];this.manifest={id:'local-loadout',name:{en:'Local loadout'},models:{},materials:{},attachments:{},systems:{},textures:{},snapshots:{},effects:[],fxModels:{}};}
 blob(bytes,mime){const url=this.createUrl(new Blob([bytes],{type:mime}));this.urls.add(url);return url;}
 url=(path)=>{if(this.files.has(path))return this.files.get(path);if(/^(?:blob:|data:|https?:)/.test(path))return path;throw Error('Unknown scene resource: '+path);};
 sanitizeMaterial(value,fallback={}){const next={...value};for(const field of ['color','normal','opacity','masks','specular','detail','fresnel','exponent','diffuseWarp','cube'])if(typeof next[field]==='string'&&!this.files.has('textures/'+next[field])){const old=fallback[field];next[field]=typeof old==='string'&&this.files.has('textures/'+old)?old:null;const message='Material texture unavailable: '+value[field];if(!this.warnings.includes(message))this.warnings.push(message);}return next;}
 source(){return{manifest:this.manifest,url:this.url};}
 addGlb(bytes,{key,owner='hero',itemId=null,register=true,model=null}={}){
  const oldUrls=new Set(this.urls),oldFiles=new Set(this.files.keys()),oldMaterials=new Set(Object.keys(this.manifest.materials));
  const glb=readGlb(bytes),meta=glb.json.extras?.dotaStudio??{},json=structuredClone({...glb.json,extras:{...glb.json.extras,dotaStudio:undefined}}),images=new Map(),prefix=key??'model-'+Object.keys(this.manifest.models).length;
  let fallback;for(const mesh of json.meshes??[])for(const primitive of mesh.primitives??[])if(primitive.material===undefined){json.materials??=[];fallback??=json.materials.push({name:'studio-geometry-fallback',pbrMetallicRoughness:{baseColorFactor:[.55,.58,.65,1],metallicFactor:0,roughnessFactor:1}})-1;primitive.material=fallback;}
  const image=index=>{if(images.has(index))return images.get(index);const img=json.images?.[index];if(!img)return null;let uri=img.uri;if(!uri&&Number.isInteger(img.bufferView)){const b=json.bufferViews?.[img.bufferView];if(!b)throw Error('Invalid GLB image');uri=this.blob(glb.bin.subarray(b.byteOffset??0,(b.byteOffset??0)+b.byteLength),img.mimeType??'image/png');}if(uri&&!/^(?:blob:|data:)/.test(uri))throw Error('GLB must contain embedded textures');const name=prefix+'-image-'+index;this.files.set('textures/'+name,uri);images.set(index,name);return name;};
  const texture=info=>{if(!info||!Number.isInteger(info.index))return null;const tex=json.textures?.[info.index];return image(tex?.extensions?.EXT_texture_webp?.source??tex?.source);};
  const materialByName=meta.materials??{};
  for(const[i,m]of(json.materials??[]).entries()){
   const original=m.name??'material-'+i,id=prefix+'::'+i,base=m.pbrMetallicRoughness??{},native=materialByName[original]??materialByName[compiled(original)]??Object.entries(materialByName).find(([n])=>n.split('/').at(-1).replace(/\.vmat(?:_c)?$/,'')===original.replace(/\.vmat(?:_c)?$/,''))?.[1];
   const embedded={color:texture(base.baseColorTexture),normal:texture(m.normalTexture)},descriptor={...embedded,alphaTest:m.alphaMode==='MASK'?(m.alphaCutoff??.5):0,translucent:m.alphaMode==='BLEND',specScale:base.metallicFactor??.2,rimScale:.15,baseColor:rgba(base.baseColorFactor),...(native?.descriptor??{})};
   for(const[field,info]of Object.entries(native?.images??{})){if(info?.data){const name=id+'-'+field;this.files.set('textures/'+name,'data:'+(info.mime??'image/png')+';base64,'+info.data);descriptor[field]=name;}}
   if(!register&&!native&&!descriptor.color){json.materials[i]={name:id};this.warnings.push('Particle model material unavailable: '+original);continue;}
   this.manifest.materials[id]=this.sanitizeMaterial(calibratePreviewMaterial(descriptor,original),embedded);this.materialMetadata.set(id,{name:original,materialPath:Object.entries(materialByName).find(([,v])=>v===native)?.[0]??original,owner,itemId});
   // The host shader loads these textures. GLTFLoader must not decode them a
   // second time for its temporary PBR materials. Binary views stay untouched.
   json.materials[i]={name:id,pbrMetallicRoughness:{baseColorFactor:base.baseColorFactor??[1,1,1,1]},doubleSided:!!m.doubleSided,alphaMode:m.alphaMode??'OPAQUE'};
  }
  for(const node of json.nodes??[]){const original=node.name;node.extras={...(node.extras??{}),studioOwner:owner,studioPart:itemId??prefix,...(original?{studioSourceName:original}:{})};if(original?.includes('/')||original?.includes('\\'))node.name=original.replaceAll('\\','/').split('/').at(-1).replace(/\.vmdl_c.*/,'');}
  if(register)this.modelMetadata.set(owner,{owner,itemId,hasSkeleton:!!json.skins?.some(s=>s.joints?.length),model:model??sourceModel(glb.json),modelExplicit:!!(model||meta.sourceModel),animations:(json.animations??[]).map(a=>({name:a.name})),metadata:meta});
  const attachments={};for(const[name,row]of Object.entries(meta.attachments??{})){const a=normalizeAttachment(row);if(a)attachments[name]=a;}if(register)this.manifest.attachments[owner]=attachments;
  // All material images are now owned by the host shader, not GLTFLoader.
  delete json.images;delete json.textures;
  const file='models/'+prefix+'.glb';this.files.set(file,this.blob(writeGlb({json,bin:glb.bin,extra:glb.extra}),'model/gltf-binary'));
  if(register){this.manifest.models[owner]=file;if(itemId)this.owners.set(itemId,owner);}
  if(owner==='hero')this.manifest.animations=sceneAnimations(json.animations??[],meta.sequences??[],[],meta.composedAdditiveAnimations===true);
  if(!register){this.effectResources??={urls:[],files:[],materials:[]};this.effectResources.urls.push(...[...this.urls].filter(u=>!oldUrls.has(u)));this.effectResources.files.push(...[...this.files.keys()].filter(k=>!oldFiles.has(k)));this.effectResources.materials.push(...Object.keys(this.manifest.materials).filter(k=>!oldMaterials.has(k)));}
  return file;
 }
 applyMetadata(results,preferred=[]){this.particleBindings=results?.particleBindings??{};for(const [owner,info] of this.modelMetadata){const data=results?.models?.[info.model]??info.metadata;const attachments={};for(const [name,row] of Object.entries({...data.attachments,...info.metadata.attachments})){const a=normalizeAttachment(row);if(a)attachments[name]=a;}if(Object.keys(attachments).length)this.manifest.attachments[owner]=attachments;this.applyMaterials(owner,{...data.materials,...info.metadata.materials});(this.manifest.wearableSequences??={})[owner]=data.sequences??info.metadata.sequences??[];if(owner==='hero'){let clips=info.animations,composed=info.metadata.composedAdditiveAnimations===true;if(!clips.length&&data.animationGlb&&info.hasSkeleton){this.addGlb(bytes64(data.animationGlb),{key:'animation-source',owner:'animation-source'});const recovery=this.modelMetadata.get('animation-source');clips=recovery.animations;composed=recovery.metadata.composedAdditiveAnimations===true;}this.manifest.animations=sceneAnimations(clips,data.sequences??[],preferred,composed);}this.manifest.animations??={};(this.manifest.animations.defaults??={})[owner]=data.activities??[];}this.warnings.push(...(results?.warnings??[]));}
 applyMaterials(owner,rows){for(const[id,info]of this.materialMetadata){if(info.owner!==owner)continue;const base=n=>String(n).split('/').at(-1).replace(/\.vmat(?:_c)?$/,'');const entry=Object.entries(rows).find(([name])=>name===info.name)??Object.entries(rows).find(([name])=>base(name)===base(info.name));if(!entry)continue;const native=entry[1],fallback={...this.manifest.materials[id]},descriptor={...fallback,...native.descriptor};info.materialPath=entry[0];for(const[field,image]of Object.entries(native.images??{}))if(image?.data){const name=id+'-native-'+field;this.files.set('textures/'+name,'data:'+(image.mime??'image/png')+';base64,'+image.data);descriptor[field]=name;}this.manifest.materials[id]=this.sanitizeMaterial(calibratePreviewMaterial(descriptor,info.name),fallback);}}

 clearEffects(){const r=this.effectResources;if(!r)return;for(const u of r.urls){this.revokeUrl(u);this.urls.delete(u);}for(const k of r.files)this.files.delete(k);for(const k of r.materials){delete this.manifest.materials[k];this.materialMetadata.delete(k);}this.effectResources=null;}
 dispose(){for(const u of this.urls)this.revokeUrl(u);this.urls.clear();this.files.clear();}
}
function normalized(value,map){if(typeof value==='string'){const v=compiled(value);return map.get(v)??v;}if(Array.isArray(value))return value.map(v=>normalized(v,map));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalized(v,map)]));return value;}
const bytes64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function effectSource(scene,entries,{glow=null}={}){
 const systems={},textures={},snapshots={},effects=[],fxModels={},materials={},bindings=[],warnings=[];
 for(const[index,entry]of entries.entries()){
  const packet=entry.packet??{};if(packet.error){warnings.push((entry.effectId??index)+': '+packet.error);continue;}
  warnings.push(...(packet.missing??[]).map(p=>'Missing particle resource: '+p));
  const prefix='studio/'+index+'/',remap=new Map();for(const path of Object.keys(packet.definitions??{}))remap.set(compiled(path),prefix+systemKey(path));
  for(const path of Object.keys(packet.textures??{}))remap.set(compiled(path),prefix+compiled(path));
  for(const path of Object.keys(packet.snapshots??{}))remap.set(compiled(path),prefix+compiled(path));
  for(const path of Object.keys(packet.models??{}))remap.set(compiled(path),prefix+compiled(path));
  for(const path of Object.keys(packet.materials??{}))remap.set(compiled(path),prefix+compiled(path));
  for(const[path,value]of Object.entries(packet.materials??{}))materials[remap.get(compiled(path))]=normalized(value,remap);
  for(const[path,value]of Object.entries(packet.definitions??{})){const id=remap.get(compiled(path)),def=normalized(value,remap);def.m_nMaxParticles=Math.min(4000,finite(def.m_nMaxParticles,1000)>0?finite(def.m_nMaxParticles,1000):1000);if(entry.color){const rgb=entry.color.map(n=>Math.round(n*255));forceParticleColor(def,rgb);enableDarkBlend(def,rgb);}systems[id]=def;}
  for(const[path,t]of Object.entries(packet.textures??{})){
   const id=remap.get(compiled(path)),file=t.data?'data:'+(t.mime??'image/png')+';base64,'+t.data:t.url;if(!file)continue;
   textures[id]={file,sequences:(t.sequences??[]).map(seq=>({clamp:!!seq.clamp,frames:(seq.frames??[]).map(frame=>{
    const im=frame.images?.[0];return{time:finite(frame.time??frame.duration,.033),uv:frame.uv??(im?[im.min[0],im.min[1],im.max[0],im.max[1]]:[0,0,1,1]),...(frame.crop?{crop:frame.crop}:im?.cropMin?{crop:[...im.cropMin,...im.cropMax]}:{})};
   })}))};
  }
  for(const[path,data]of Object.entries(packet.snapshots??{})){const id=remap.get(compiled(path));snapshots[id]=normalizeSnapshot(data);}
  for(const[path,m]of Object.entries(packet.models??{}))if(m.data){const id=remap.get(compiled(path)),bytes=bytes64(m.data),json=readGlb(bytes).json,clips=particleModelClips(json,m.clips);const file=scene.addGlb(bytes,{key:'fx-'+index+'-'+Object.keys(fxModels).length,owner:'fx',register:false});fxModels[id]={file,clips};}
  const root=remap.get(compiled(packet.root));if(!root||!systems[root]){warnings.push((entry.effectId??index)+': корневой партикл отсутствует');continue;}
  const owner=entry.scope==='hero'?'hero':scene.owners.get(entry.itemId)??'hero',id='effect-'+index;
  for(const config of systems[root].m_controlPointConfigurations??[])for(const driver of config.m_drivers??[]){const name=driver.m_attachmentName;if(name&&/POINT/.test(String(driver.m_iAttachType))&&!Object.values(scene.manifest.attachments).some(group=>Object.hasOwn(group,name)))warnings.push((entry.effectId??id)+': отсутствует точка крепления '+name);}
  applyParticleBinding(systems[root],entry.binding??scene.particleBindings?.[String(packet.root).replace(/_c$/,'')]);
  bindings.push({id,system:root,owner,effectId:entry.effectId??id,itemId:entry.itemId??null,color:entry.color??null,ghost:!!entry.ghost});effects.push({system:root,owner,color:entry.color??null});
 }
 if(glow)for(const path of ['materials/particle/particle_glow_05.vtex','materials/particle/particle_glow_01.vtex','materials/particle/smoke1/smoke1.vtex'])textures[path]??={file:glow};
 return{systems,textures,snapshots,effects,fxModels,materials,bindings,warnings};
}

export function applyParticleBinding(def,binding){
 if(!binding||(!binding.attach_type&&!binding.control_points))return;
 const points=Object.entries(binding.control_points??{}),drivers=[];
 const add=(index,row)=>{const cp=Number(row.control_point_index??index);if(!Number.isInteger(cp)||cp<0||cp>63)return;const type=String(row.attach_type??'absorigin_follow').toUpperCase();drivers.push({m_iControlPoint:cp,m_iAttachType:type.startsWith('PATTACH_')?type:'PATTACH_'+type,m_entityName:row.attach_entity??binding.attach_entity??'self',...(row.attachment?{m_attachmentName:row.attachment}:{})});};
 if(!points.some(([i,p])=>Number(p.control_point_index??i)===0))add(0,binding);
 for(const [i,row] of points)add(i,row);
 const configs=def.m_controlPointConfigurations??=[],preview=configs.find(c=>c.m_name==='preview');
 // Native definitions own the complete CP setup. Economy rows frequently
 // describe CP0 only; keep authored attachments, entities and constant offsets.
 const authored=preview??configs[0],merged=[...(authored?.m_drivers??[])],occupied=new Set(merged.map(d=>Number(d.m_iControlPoint??0)));
 for(const driver of drivers)if(!occupied.has(driver.m_iControlPoint)){occupied.add(driver.m_iControlPoint);merged.push(driver);}
 if(preview)preview.m_drivers=merged;else configs.unshift({m_name:'preview',m_drivers:merged});
}

export function particleModelClips(json,authored={}){const usable=(json.animations??[]).filter(a=>a.name&&!a.name.startsWith('@')&&a.name!=='bindPose'),names=new Set(usable.map(a=>a.name)),clips=Object.fromEntries(Object.entries(authored??{}).filter(([,name])=>names.has(name)));for(const row of json.extras?.dotaStudio?.sequences??[])if(row.activity&&names.has(row.name)&&!clips[row.activity]&&!(row.modifiers?.length))clips[row.activity]=row.name;clips.ACT_DOTA_IDLE??=usable.find(a=>/(^|[_/])(idle|loop)([_/]|$)/i.test(a.name))?.name??usable[0]?.name;return clips;}
