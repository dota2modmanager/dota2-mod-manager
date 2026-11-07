// Rigid-snapshot fitting follows dota-loadout tools/lib/hero.mjs (MIT).
// A KD tree bounds the nearest-vertex work instead of scanning every vertex.
import * as THREE from 'three';
import {activeSkinJoints} from '../src/skin-joints.js';
export {normalizeSnapshot} from './snapshot-data.mjs';

function tree(points,depth=0){if(!points.length)return null;const axis=depth%3;points.sort((a,b)=>a[axis]-b[axis]);const mid=points.length>>1;return{p:points[mid],axis,left:tree(points.slice(0,mid),depth+1),right:tree(points.slice(mid+1),depth+1)};}
function nearest(node,p,best=Infinity){if(!node)return best;const d=p.reduce((s,v,i)=>s+(v-node.p[i])**2,0);best=Math.min(best,d);const delta=p[node.axis]-node.p[node.axis],first=delta<0?'left':'right',second=delta<0?'right':'left';best=nearest(node[first],p,best);if(delta*delta<best)best=nearest(node[second],p,best);return best;}
export class SnapshotFitter{
 constructor(models,sourceToGltf){this.models=models;this.toSource=sourceToGltf.clone().invert();}
 prepare(){if(this.frames)return;this.frames=new Map();const vertices=[],point=new THREE.Vector3();for(const model of this.models)model.scene.traverse(mesh=>{
  if(!mesh.isMesh)return;const attr=mesh.geometry.getAttribute('position'),step=Math.max(1,Math.ceil(attr.count/4000));for(let i=0;i<attr.count;i+=step)vertices.push(point.fromBufferAttribute(attr,i).applyMatrix4(this.toSource).toArray());
  if(mesh.isSkinnedMesh){const active=activeSkinJoints(mesh);mesh.skeleton.bones.forEach((b,i)=>{if(!active.has(i))return;const name=b.userData.studioSourceName||b.name;if(!this.frames.has(name))this.frames.set(name,this.toSource.clone().multiply(mesh.skeleton.boneInverses[i].clone().invert()).multiply(new THREE.Matrix4().makeScale(.0254,.0254,.0254)));});}
 });this.tree=tree(vertices);this.models=null;}
 fit(snapshots){const rows=Object.values(snapshots??{}).filter(s=>!s.bone&&!s.skinning?.some(row=>row?.length)&&s.position?.length);if(!rows.length)return;this.prepare();if(!this.tree)return;const point=new THREE.Vector3();for(const s of rows){const step=Math.max(1,Math.ceil(s.position.length/64)),points=s.position.filter((_,i)=>i%step===0);let best;for(const [bone,matrix]of this.frames){let error=0;for(const p of points)error+=Math.sqrt(nearest(this.tree,point.fromArray(p).applyMatrix4(matrix).toArray()));error/=points.length;if(!best||error<best.error)best={bone,error};}if(best&&best.error<6)s.bone=best.bone;}}
}

// Every effect instance owns its bind data. A shared bone name may have a
// different inverse bind on an arcana/refit than on the default hero mesh.
export function snapshotBinding(meshes,sourceToGltf,fallback){
 const inverse=sourceToGltf.clone().invert(),joints=new Map(),fitted=new WeakMap();
 for(const mesh of meshes)if(mesh.isSkinnedMesh){const active=activeSkinJoints(mesh);mesh.skeleton.bones.forEach((bone,i)=>{if(!active.has(i))return;for(const name of new Set([bone.userData.studioSourceName||bone.name,bone.name]))if(!joints.has(name.toLowerCase()))joints.set(name.toLowerCase(),{bone,inverse:mesh.skeleton.boneInverses[i]});});}
 const scene={traverse:fn=>meshes.forEach(fn)},fitter=new SnapshotFitter([{scene}],sourceToGltf);
 return {
  skin(position,skin){const point=position.clone().applyMatrix4(sourceToGltf),out=new THREE.Vector3();let total=0;for(const[name,weight]of skin){if(!(weight>0))continue;const joint=joints.get(name.toLowerCase());const p=joint?point.clone().applyMatrix4(joint.inverse).applyMatrix4(joint.bone.matrixWorld).applyMatrix4(inverse):fallback.skin(position,[[name,1]]);out.addScaledVector(p,weight);total+=weight;}return total?out.divideScalar(total):position.clone();},
  snapshotData(data){if(fitted.has(data))return fitted.get(data);const copy={...data};fitter.fit({snapshot:copy});fitted.set(data,copy);return copy;}
 };
}
