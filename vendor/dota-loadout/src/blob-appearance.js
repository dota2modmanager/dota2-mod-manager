/** Native Source 2 ice_surface_dota.vfx is a translucent energy surface,
 * not a highly polished metallic sphere. Keep the approximation restricted
 * to the known Tinker Cosmic weapon blob so other particle effects do not
 * change appearance. */
export function blobAppearance(materialPath, native) {
  const isTinker = /(?:^|\/)tinker_cosmic_weapon_blob\.vmat(?:_c)?$/i.test(String(materialPath||''));
  if (!isTinker) return {
    tint: native?.vectors?.g_vColorTint ?? [1, 1, 1],
    metalness: 0.35, roughness: 0.16, clearcoat: 1, opacity: 0.9,
  };
  return {
    tint: native?.vectors?.g_vSpecularColor ?? [0.75, 0.56, 1],
    metalness: 0, roughness: 0.55, clearcoat: 0, opacity: 0.65,
  };
}
