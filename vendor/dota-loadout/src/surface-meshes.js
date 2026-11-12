// Hero-scoped systems sample the dressed hero, including mounts.
// The pedestal and animation recovery proxies are not part of that surface.
export function particleSurfaceMeshes(heroMeshes,worn,owner){
 const meshes=owner==='hero'||!owner?[...heroMeshes,...[...worn].filter(([slot])=>!['pedestal','animation-source'].includes(slot)).flatMap(([,w])=>w.meshes??[])]:worn.get(owner)?.meshes??[];
 return [...new Set(meshes)].filter(m=>m.visible&&m.geometry?.attributes.position);
}
