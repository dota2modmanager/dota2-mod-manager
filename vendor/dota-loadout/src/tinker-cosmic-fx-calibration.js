/**
 * Preview-only approximations for Interstellar Astrarium (Tinker).
 *
 * Source 2 composes high-gain additive sprites with UV-distortion layers and
 * exposure. The simplified Three.js sprite renderer does not implement those
 * composite stages, so the Source values can produce opaque / blown-out discs.
 * Scope ALL corrections to named Cosmic particle systems, never to other heroes.
 */

function literal(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && value.m_nType === 'PF_TYPE_LITERAL' &&
      typeof value.m_flLiteralValue === 'number' && Number.isFinite(value.m_flLiteralValue))
    return value.m_flLiteralValue;
  return fallback;
}
function valueLike(original, value) {
  // Preserve the input parameter's native Source 2 representation when possible.
  if (original && typeof original === 'object')
    return { ...original, m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: value };
  return value;
}

/** Return the untouched object for all non-Cosmic / non-sprite renderers. */
export function calibrateCosmicFxRenderer(renderer, systemPath) {
  if (!renderer || typeof renderer !== 'object') return renderer;
  const path = String(systemPath || '').replaceAll('\\', '/').toLowerCase();
  const name = path.split('/').pop().replace(/\.vpcf(?:_c)?$/, '');
  if (!name.startsWith('tinker_cosmic_') || renderer._class !== 'C_OP_RenderSprites') return renderer;

  const tex = renderer.m_vecTexturesInput?.find(i => i?.m_hTexture)?.m_hTexture?.split('/').at(-1)?.toLowerCase() || '';
  let maxBright, radiusFactor;
  let maxRadius = Infinity, alphaFactor = 1, softenDisc = false;
  if (name === 'tinker_cosmic_weapon_ambient_blob' && tex === 'primitive_circle_solid.vtex') {
    // This uses TWO Source 2 caustic/zoom textures that our lightweight shader
    // doesn't yet composite. Without them, a radius-1.7 × overbright-10 disc is
    // drawn flat and hides the head / upper body from another camera angle.
    maxBright = 1.05; radiusFactor = 0.48; alphaFactor = 0.48; softenDisc = true;
  } else if (name === 'tinker_cosmic_shoulder_ambient_flare' &&
     /^(?:pro_flares|combined_flare|anam_white_bloom)\.vtex$/.test(tex)) {
    maxBright = 1.05; radiusFactor = 0.72; alphaFactor = 0.54;
  } else if (name === 'tinker_cosmic_weapon_ambient_light' || name === 'tinker_cosmic_offhand_ambient_light') {
    if (renderer.m_nOutputBlendMode === 'PARTICLE_OUTPUT_BLEND_MODE_MOD2X') return renderer;
    maxBright = 1.25; radiusFactor = 0.7; alphaFactor = 0.8;
  } else if (name === 'tinker_cosmic_shoulder_ambient_rays' || name === 'tinker_cosmic_shoulder_ambient_rays_b') {
    maxBright = 1.35; radiusFactor = 0.8; alphaFactor = 0.72;
  } else if (name === 'tinker_cosmic_shoulder_ambient_glow') {
    maxBright = 1.35; radiusFactor = 0.8;
  } else if (name === 'tinker_cosmic_shoulder_ambient_triangle' && tex === 'aircraft_white.vtex') {
    // The authored scale is 30. Multiplication alone still leaves a giant card.
    maxBright = 1.2; radiusFactor = 0.50; maxRadius = 1.5; alphaFactor = 0.65;
  } else return renderer;

  const r = { ...renderer };
  const brightness = literal(renderer.m_flOverbrightFactor, 1);
  r.m_flOverbrightFactor = valueLike(renderer.m_flOverbrightFactor, Math.min(maxBright, brightness));
  const radius = literal(renderer.m_flRadiusScale, 1);
  r.m_flRadiusScale = valueLike(renderer.m_flRadiusScale, Math.min(radius * radiusFactor, maxRadius));
  if (alphaFactor !== 1) {
    const original = literal(renderer.m_flAlphaScale, 1);
    r.m_flAlphaScale = valueLike(renderer.m_flAlphaScale, original * alphaFactor);
  }
  if (softenDisc) r.studioSoftDisc = true;
  return r;
}
