/* How much the window can afford to draw, decided once at start, with no switch to find.
 *
 * Without a GPU (an old integrated chip, a broken driver, a remote desktop) the browser draws in
 * software: a blur behind a window, a big soft shadow or a card lifting under the pointer is then
 * paid for on the processor at every frame, and on such a machine scrolling a category stuttered
 * while the same build ran smooth on a desktop. The browser says which renderer it got; a
 * software one, or no WebGL at all, puts the window on the light look (styles/lite.css), which
 * keeps every colour and layout and lets go of what only moves or blurs. */

/** Whether a WebGL renderer's name is one that draws on the processor. */
export const softwareName = (name: string): boolean => /swiftshader|basic render|llvmpipe|softpipe|software/i.test(name);

/** Whether the browser is drawing without a GPU. */
export function softwareDrawn(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) as WebGLRenderingContext | null;
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return softwareName(name);
  } catch {
    return false;
  }
}

/** The look for this machine: light where drawing is done in software or the processor is small. */
export function gfxTier(): 'full' | 'lite' {
  const cores = navigator.hardwareConcurrency || 8;
  return cores <= 2 || softwareDrawn() ? 'lite' : 'full';
}

if (typeof document !== 'undefined') document.documentElement.dataset.gfx = gfxTier();
