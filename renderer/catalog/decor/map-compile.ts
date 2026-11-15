/* The map put on the graphics card a few materials at a time before its first frame, the window
 * let go between them: done at once, by the first frame or by compileAsync (which this browser
 * runs in one go), a hundred-odd programs, their shadows' and seventy megabytes of geometry held
 * the window two seconds. Each step draws its meshes, shadows too, which compiles their programs
 * and uploads their geometry; the first real frame then has nothing left to do. */
import * as THREE from 'three';

export async function compileInSteps(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, perStep = 10): Promise<void> {
  const meshes: THREE.Object3D[] = [];
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
  const was = new Map(meshes.map((o) => [o, o.visible]));
  // the meshes in steps of a few materials each, every mesh in one step
  const byMaterial = new Map<string, THREE.Object3D[]>();
  for (const o of meshes) {
    if (!was.get(o)) continue;
    const key = [(o as THREE.Mesh).material].flat().map((m) => m.uuid).join('|') + ((o as THREE.InstancedMesh).isInstancedMesh ? '|i' : '');
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), o]);
  }
  const groups = [...byMaterial.values()];
  for (const o of meshes) o.visible = false;
  try {
    for (let i = 0; i < groups.length; i += perStep) {
      const step = groups.slice(i, i + perStep).flat();
      for (const o of step) o.visible = true;
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      for (const o of step) o.visible = false;
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    for (const [o, v] of was) o.visible = v;
    // the shadows of the whole map, once, with everything on the card already
    renderer.shadowMap.needsUpdate = true;
  }
}
