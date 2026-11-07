/**
 * Preview-specific calibration for Tinker's Interstellar Astrarium.
 * Its native hero.vfx materials specify specularScale 17 and rimScale 5.
 * Feeding those directly into the simplified Three.js Phong reconstruction
 * overexposes broad metalness areas; the actual Dota renderer applies more
 * lighting stages before displaying them. Keep the exported textures and
 * channels intact, only reduce the preview's lighting gain.
 */
export function calibratePreviewMaterial(descriptor, materialName) {
  const basename = String(materialName ?? '').replaceAll('\\', '/').split('/').at(-1).replace(/\.vmat(?:_c)?$/i, '');
  if (!/^tinker_cosmic_(?:head|shoulders|back|weapon|offhand)$/.test(basename)) return descriptor;
  const reduce = (v, limit) => typeof v === 'number' && Number.isFinite(v) ? Math.min(v, limit) : v;
  return { ...descriptor, specScale: reduce(descriptor.specScale, 2.2), rimScale: reduce(descriptor.rimScale, 2.0) };
}
