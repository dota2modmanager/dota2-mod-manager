// The light look (renderer/ui/gfx.ts, styles/lite.css) goes on where the browser draws without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { softwareName } from '../renderer/ui/gfx.ts';

test('a software renderer is told from a GPU by its name', () => {
  for (const name of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
  ]) assert.equal(softwareName(name), true, name);
  for (const name of [
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ]) assert.equal(softwareName(name), false, name);
});
