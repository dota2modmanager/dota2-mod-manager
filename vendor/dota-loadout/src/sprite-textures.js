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

export function resolveSpriteTextures(renderer = {}) {
  const inputs = Array.isArray(renderer.m_vecTexturesInput) ? renderer.m_vecTexturesInput : [];
  const usable = inputs.map((input, index) => ({ input: input || {}, index }))
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
