import { Box3, Mesh, Vector3, type Object3D } from 'three';

/** Native particle buffers are in Source inches until their group matrix has reached the meshes.
 * Measure only live draw ranges: unused capacity and particles from the last batch are not bounds. */
export function loadoutParticleBounds(group: Object3D): Box3 {
  group.updateWorldMatrix(true, true, true);
  const box = new Box3(), point = new Vector3();
  group.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry, positions = geometry.getAttribute('position');
    if (!positions) return;
    const index = geometry.index;
    const start = geometry.drawRange.start;
    const end = Math.min(index?.count ?? positions.count, start + geometry.drawRange.count);
    for (let i = start; i < end; i++) {
      object.getVertexPosition(index ? index.getX(i) : i, point).applyMatrix4(object.matrixWorld);
      if (Number.isFinite(point.x + point.y + point.z)) box.expandByPoint(point);
    }
  });
  return box;
}
