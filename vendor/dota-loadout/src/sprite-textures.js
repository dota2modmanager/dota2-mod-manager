// Source 2 sprite cards may leave slot 0 blank (UV transforms) and use later
// slots for the visible texture and/or alpha masks. Never render a distortion
// texture as the sprite's colour: its opaque channels are visible as squares.
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
    channel: first?.input.m_nTextureChannels || null,
    maskPath: mask?.input.m_hTexture || null,
    // Standalone alpha-cloud textures use RGB as coverage (their PNG alpha
    // channel is 255 across the entire image).
    alphaFromLuma: !!path && /\/alpha\//i.test(path),
    // Source's lens-flare sprites are often exported as opaque PNGs with the
    // actual flare coverage packed into RGB. The Source A channel mix would
    // otherwise turn that opaque alpha into a solid white rectangular card.
    alphaChannelFromLuma: !!path && first?.input.m_nTextureChannels === 'SPRITECARD_TEXTURE_CHANNEL_MIX_A' &&
      /\/lens_flare\/|\/(?:combined_flare|anam_white_bloom)\.vtex$/i.test(path),
  };
}
