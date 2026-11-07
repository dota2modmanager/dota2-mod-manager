import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resource,encodeKv3,rerl,type V } from './helpers/kv3-build.ts';
import { readLoadoutMaterial,loadoutDescriptor } from '../src/loadout-material.ts';
import { loadoutResources,loadoutModel,resourcePaths } from '../src/loadout-resources.ts';
import { loadoutSheet } from '../src/loadout-sheet.ts';
import { exportArgs } from '../src/model-glb.ts';
import { animatedLoadoutModel } from './fixtures/loadout-model.ts';
import { readGlb } from '../vendor/dota-loadout/studio/scene-source.mjs';
const material=()=>resource([['DATA',encodeKv3({obj:[
 ['m_shaderName',{str:'hero.vfx'}],
 ['m_floatParams',{objs:[[['m_name',{str:'g_flSpecularScale'}],['m_flValue',{dbl:0}]]]}],
 ['m_intParams',{objs:[[['m_name',{str:'F_ADDITIVE_BLEND'}],['m_nValue',{int:1}]]]}],
 ['m_vectorParams',{objs:[[['m_name',{str:'g_vRimLightColor'}],['m_value',{obj:[['x',{dbl:.2}],['y',{dbl:.3}],['z',{dbl:.4}],['w',{dbl:1}]]}]]]}],
 ['m_textureParams',{objs:[[['m_name',{str:'g_tMasks1'}],['m_pValue',{str:'materials/mask.vtex'}]]]}],
]})]]);

test('native material parameters retain packed mask paths, zero values and vector fields',()=>{
 const result=readLoadoutMaterial(material())!;assert.equal(result.textures.g_tMasks1,'materials/mask.vtex');assert.deepEqual(result.vectors.g_vRimLightColor,[.2,.3,.4,1]);
 const descriptor=loadoutDescriptor(result);assert.equal(descriptor.specScale,0);assert.equal(descriptor.additive,true);
 assert.equal(readLoadoutMaterial(null),null);assert.equal(readLoadoutMaterial(Buffer.from('broken')),null);
});

test('native VTEX sheet keeps authored sequence ids, timing and trim rectangles',()=>{
 const data=Buffer.alloc(124);data.writeUInt16LE(1);data.writeUInt32LE(8,32);data.writeUInt32LE(1,36);data.writeUInt32LE(2,40);data.writeUInt32LE(8,44);data.writeUInt32LE(72,48);
 const sheet=data.subarray(52);sheet.writeInt32LE(8,0);sheet.writeUInt32LE(1,4);sheet.writeUInt32LE(7,8);sheet[12]=1;sheet.writeInt32LE(24,16);sheet.writeUInt32LE(1,20);
 sheet.writeFloatLE(.125,40);sheet.writeInt32LE(8,44);sheet.writeUInt32LE(1,48);
 // Increase the allocation to include a complete image rectangle at sheet offset 52.
 const bytes=Buffer.concat([data,Buffer.alloc(12)]);const full=bytes.subarray(52);bytes.writeUInt32LE(84,48);
 [.1,.2,.8,.9,0,0,1,1].forEach((v,i)=>full.writeFloatLE(v,52+i*4));
 const result=loadoutSheet(resource([['DATA',bytes]]));assert.equal(result[0].id,7);assert.equal(result[0].clamp,true);assert.equal(result[0].frames[0].time,.125);assert.deepEqual(result[0].frames[0].uv,[0,0,1,1]);
 assert.deepEqual(loadoutSheet(Buffer.from('bad')),[]);assert.deepEqual(loadoutSheet(null),[]);
});

test('complete particle dependencies keep snapshots, materials and animated model textures',async(t)=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'loadout-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const model=path.join(root,'prop.glb');fs.writeFileSync(model,animatedLoadoutModel());
 const attributes:V={objs:[[['name',{str:'position'}],['type',{str:'float3'}]]]};const snap=Buffer.alloc(16);snap.writeUInt32LE(0x8000000c);snap.writeFloatLE(2,4);
 const snapshot=resource([['DATA',encodeKv3({obj:[['num_particles',{int:1}],['attributes',attributes]]})],['SNAP',snap]]);
 const modelData=resource([['RERL',rerl(['materials/hero.vmat', 'models/reference_only.vmdl'])]]);
 const files:Record<string,Buffer>={'particles/a.vsnap_c':snapshot,'models/prop.vmdl_c':modelData,'models/reference_only.vmdl_c':modelData,'materials/hero.vmat_c':material(),'materials/mask.vtex_c':resource([['DATA',Buffer.alloc(40)]])};
 let full=false;
 const glb={glbs:async(paths:string[],clips?:string[]|'all',materials?:boolean)=>{assert.deepEqual(paths,['models/prop.vmdl']);full=clips==='all'&&materials===true;return{'models/prop.vmdl':model};},sprites:async()=>({'materials/mask.vtex':Buffer.from('PNG')})};
 const def={path:'particles/root.vpcf',children:[],tree:{m_hSnapshot:'particles/a.vsnap',m_hModel:'models/prop.vmdl',missing:'materials/missing.vtex'}};
 const result=await loadoutResources([def],p=>files[p]??null,glb);assert.equal(full,true);assert.deepEqual(result.snapshots['particles/a.vsnap'].position,[[2,0,0]]);assert.equal(result.materials['materials/hero.vmat'].textures.g_tMasks1,'materials/mask.vtex');assert.ok(result.models['models/prop.vmdl'].data);assert.ok(result.missing.includes('materials/missing.vtex'));
 const enriched=await loadoutModel(model,'models/prop.vmdl',p=>files[p]??null,glb),meta=readGlb(enriched).json.extras.dotaStudio;
 assert.equal(meta.materials['materials/hero.vmat'].descriptor.specScale,0);assert.equal(meta.materials['materials/hero.vmat'].images.masks.data,Buffer.from('PNG').toString('base64'));
 assert.ok(exportArgs('pak','out',['model'],'all',true).includes('--gltf_export_materials'));assert.ok(!exportArgs('pak','out',['model'],'all').includes('--gltf_export_materials'));
 assert.deepEqual(resourcePaths({a:'materials/../../escape.vtex',b:'https://bad/a.vtex',c:'models/prop.vmdl'}),['models/prop.vmdl']);
});
