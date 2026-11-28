// Source 2 sprite cards may leave slot 0 blank (UV transforms) and use later
// slots for the visible texture and/or alpha masks. Never render a distortion
// texture as the sprite's colour: its opaque channels are visible as squares.
const literal = (x, fallback) => (typeof x === 'number' ? x : x?.m_nType === 'PF_TYPE_LITERAL' ? x.m_flLiteralValue ?? fallback : fallback);

// A layer with m_bReplaceTextureWithGradient: its picture is the gradient laid across the card, and the
// card is multiplied by it. The game's vertex shader hands the layer the card's UV turned by the layer's
// rotation and moved by its offset (RenderDoc, the river's waves, map_riverflow_waves.vpcf: 90° and
// V + 0.3 gave (1 - v, u + 0.3)); a 64 × 1 picture, only its U counts. The river's rings are lit on
// one side only this way (grey at the edge, white at 0.16, black past 0.45): drawn whole, every wave
// was a bright full ring.
function gradientLayer(inputs) {
  const layer = inputs.find((input) => input?.m_bReplaceTextureWithGradient && input.m_Gradient?.m_Stops?.length);
  if (!layer) return null;
  const c = layer.m_TextureControls || {};
  return {
    stops: layer.m_Gradient.m_Stops.map((s) => ({ at: s.m_flPosition ?? 0, color: (s.m_Color || [255, 255, 255, 255]).slice(0, 4) })).sort((a, b) => a.at - b.at),
    turns: ((Math.round(literal(c.m_flFinalTextureUVRotation, 0) / 90) % 4) + 4) % 4,
    offset: [literal(c.m_flFinalTextureOffsetU, 0), literal(c.m_flFinalTextureOffsetV, 0)],
  };
}

// A control of a layer as a value and a rate: a literal, or the effect's age times a factor (the river's
// noise scrolls by 0.3 a second).
function control(x) {
  if (x?.m_nType === 'PF_TYPE_COLLECTION_AGE' && x.m_nMapType === 'PF_MAP_TYPE_MULT') return { at: 0, rate: x.m_flMultFactor ?? 0 };
  return { at: literal(x, 0), rate: 0 };
}
const PER_PARTICLE = { SPRITECARD_TEXTURE_PP_SCALE_SHADER_EXTRA_DATA1: 39, SPRITECARD_TEXTURE_PP_SCALE_SHADER_EXTRA_DATA2: 40 };

// A later layer the card is multiplied by, part way (m_flTextureBlend): the river's waves take a
// turbulent noise at 0.6, which breaks their rings into patches. The game's spritecard (RenderDoc, the
// river's waves): colour and alpha become mix(card, card × layer, blend). The layer's UV is the card's
// divided by its scale times the particle's scale field (SHADER_EXTRA_DATA1 is field 39: 1.604, 1.661,
// 1.311 gave spans of 1.038, 1.004, 1.272 at a scale of 0.6), then moved by its offset, a random one per
// particle (m_bRandomizeOffsets) and the effect's age times its rate. Other blend modes are left out.
function multiplyLayer(usable, taken) {
  const found = usable.find(({ input, index }) => !taken.has(index) && input.m_flTextureBlend !== undefined);
  if (!found) return null;
  const { input } = found, c = input.m_TextureControls || {};
  if (input.m_nTextureBlendMode && input.m_nTextureBlendMode !== 'SPRITECARD_TEXTURE_BLEND_MULTIPLY') return null;
  const u = control(c.m_flFinalTextureOffsetU), v = control(c.m_flFinalTextureOffsetV);
  return {
    path: input.m_hTexture,
    blend: literal(input.m_flTextureBlend, 1),
    scale: [literal(c.m_flFinalTextureScaleU, 1), literal(c.m_flFinalTextureScaleV, 1)],
    offset: [u.at, v.at],
    rate: [u.rate, v.rate],
    random: c.m_bRandomizeOffsets === true,
    field: PER_PARTICLE[c.m_nPerParticleScale] ?? null,
  };
}

export function resolveSpriteTextures(renderer = {}) {
  const inputs = Array.isArray(renderer.m_vecTexturesInput) ? renderer.m_vecTexturesInput : [];
  // a layer switched off is not drawn (the river's plasma noise)
  const usable = inputs.map((input, index) => ({ input: input || {}, index }))
    .filter(({ input }) => input.m_bEnabled !== false)
    .filter(({ input }) => typeof input.m_hTexture === 'string' && input.m_hTexture.length > 0)
    .filter(({ input }) => input.m_nTextureType !== 'SPRITECARD_TEXTURE_UVDISTORTION');
  const first = usable[0];
  // Some Source 2 renderers have UV-control-only entries and no colour image.
  // The old renderer substituted an unrelated glow, often a huge opaque quad.
  const path = first?.input.m_hTexture || (inputs.length ? null : renderer.m_hTexture || null);
  const mask = usable.find(({ input, index }) => index !== first?.index && (
    /\/alpha\//i.test(input.m_hTexture) ||
    /SPRITECARD_TEXTURE_(?:ALPHA|MASK)/i.test(input.m_nTextureType || '') ||
    /SPRITECARD_TEXTURE_CHANNEL_MIX_(?:A|RALPHA|GALPHA|BALPHA)$/i.test(input.m_nTextureChannels || '')
  ));
  return {
    path,
    gradient: gradientLayer(inputs),
    multiply: multiplyLayer(usable, new Set([first?.index, mask?.index])),
    channel: first?.input.m_nTextureChannels || null,
    maskPath: mask?.input.m_hTexture || null,
    // Standalone alpha-cloud textures use RGB as coverage (their PNG alpha
    // channel is 255 across the entire image).
    alphaFromLuma: !!path && /\/alpha\//i.test(path),
    // A seamless tile as the colour (tile_starfield: the Tormentor's shield dander) is a pattern the
    // game's card shader fades out at the edge; drawn whole it was a square of light.
    tiled: !!path && !mask && /(?:^|\/)tile(?:\/|_)[^/]*$|\/tile\//i.test(path),
    // Source's lens-flare sprites are often exported as opaque PNGs with the
    // actual flare coverage packed into RGB. The Source A channel mix would
    // otherwise turn that opaque alpha into a solid white rectangular card.
    alphaChannelFromLuma: !!path && first?.input.m_nTextureChannels === 'SPRITECARD_TEXTURE_CHANNEL_MIX_A' &&
      (/\/lens_flare\//i.test(path) || /\/(?:combined_flare|anam_white_bloom)\.vtex$/i.test(path)),
  };
}
