// QUALITY TIERS: potato, normal, gaming. Picked once from what the browser says about the machine,
// then corrected by how fast the first seconds actually run; a page can offer a selector, and the
// choice is remembered. ?q=potato|normal|gaming in the address forces one. Each page decides what
// a tier means for its own settings - this only decides the tier.
//
// Detection, in order:
//   a software renderer (SwiftShader, llvmpipe)    -> potato
//   no WebGL2                                      -> potato (Jacob's work PC)
//   under 4 GB of memory or 4 cores                -> potato
//   a phone or tablet                              -> normal
//   a known dedicated GPU (GeForce, Radeon RX/Pro, Apple M, Arc) -> gaming
//   anything else (integrated graphics)            -> normal
export const TIERS = ['potato', 'normal', 'gaming'];
const KEY = 'jconra.quality';

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch (e) { return ''; }
}

export function detectTier(renderer) {
  const name = gpuName(renderer), mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(name)) return { tier: 'potato', why: 'software rendering, no graphics card in use' };
  if (!renderer.capabilities.isWebGL2) return { tier: 'potato', why: 'no WebGL2' + (name ? ' · ' + name : '') };
  if (mem < 4 || cores < 4) return { tier: 'potato', why: `${mem} GB, ${cores} cores` };
  if (mobile) return { tier: 'normal', why: 'phone or tablet' };
  if (/GeForce|RTX|GTX|Quadro|Radeon (RX|Pro)|Apple M\d|Arc\(TM\)|Arc A/i.test(name)) return { tier: 'gaming', why: name };
  return { tier: 'normal', why: name || 'unknown graphics' };
}

// The tier to use now: forced by the address, else remembered, else detected.
export function chooseTier(renderer) {
  const q = new URLSearchParams(location.search).get('q');
  if (TIERS.includes(q)) return { tier: q, why: 'from the address', source: 'forced' };
  try { const saved = localStorage.getItem(KEY); if (TIERS.includes(saved)) return { tier: saved, why: 'your choice', source: 'saved' }; } catch (e) { /* no storage */ }
  return { ...detectTier(renderer), source: 'detected' };
}
export function saveTier(tier) { try { if (tier) localStorage.setItem(KEY, tier); else localStorage.removeItem(KEY); } catch (e) { /* no storage */ } }

// Watch the frame rate for a while after starting (the first `settle` seconds are skipped: loading
// and baking). If a detected tier runs under `floor` fps it steps down once, and calls `onChange`.
// Nothing happens for a tier the person chose or forced.
export function watchFrames(choice, onChange, { settle = 6, window = 4, floor = 28 } = {}) {
  if (choice.source !== 'detected') return () => {};
  let t0 = performance.now(), frames = 0, done = false;
  return function tick() {
    if (done) return;
    const t = (performance.now() - t0) / 1000;
    if (t < settle) return;
    frames++;
    if (t >= settle + window) {
      done = true;
      const fps = frames / window, i = TIERS.indexOf(choice.tier);
      if (fps < floor && i > 0) { choice.tier = TIERS[i - 1]; choice.why = `ran at ${fps.toFixed(0)} fps`; onChange(choice); }
    }
  };
}
