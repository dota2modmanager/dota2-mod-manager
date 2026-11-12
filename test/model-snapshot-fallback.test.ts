import test from 'node:test';
import assert from 'node:assert/strict';
import {writeGlb} from '../src/glb-embed.ts';
import {snapshotFromModel} from '../src/model-snapshot-fallback.ts';

function sampleGlb() {
  const bin=Buffer.alloc(3*12+3*8+3*16);
  for(let i=0;i<3;i++) {
    // GLTF metres, Y up: source snapshot should be inches, Z up.
    [i+1,2,3].forEach((v,j)=>bin.writeFloatLE(v,i*12+j*4));
    bin.writeUInt16LE(0,36+i*8);
    bin.writeFloatLE(1,60+i*16);
  }
  return writeGlb({
    asset:{version:'2.0'},
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:48}],
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:'VEC3'},
      {bufferView:1,componentType:5123,count:3,type:'VEC4'},
      {bufferView:2,componentType:5126,count:3,type:'VEC4'},
    ],
    skins:[{joints:[1]}],
    meshes:[{primitives:[{attributes:{POSITION:0,JOINTS_0:1,WEIGHTS_0:2}}]}],
    nodes:[{name:'weapon',mesh:0,skin:0},{name:'weapon0_0'}],
  } as never,bin);
}

test('missing PA snapshot recovers finite positions and real skin bone bindings',()=>{
  const snapshot=snapshotFromModel(sampleGlb(),'right',3);
  assert.ok(snapshot);
  assert.equal(snapshot.position.length,3);
  assert.ok(Math.abs(snapshot.position[0][0]-3/.0254)<1e-4);
  assert.ok(Math.abs(snapshot.position[0][1]-1/.0254)<1e-4);
  assert.ok(Math.abs(snapshot.position[0][2]-2/.0254)<1e-4);
  assert.deepEqual(snapshot.skinning[0],[['weapon0_0',1]]);
});

test('do not create a fake surface if the model has no vertex positions',()=>{
  const empty=writeGlb({asset:{version:'2.0'},nodes:[],meshes:[]} as never,Buffer.alloc(0));
  assert.equal(snapshotFromModel(empty),null);
});
