// THE WARM-UP QUEUE: each scene of a page got ready to draw a little at a time, long before it is shown, so that cutting to
// it doesn't stall. The first time three.js draws something it sends its pictures to the graphics card, builds the shaders
// its materials need (and their shadow-pass twins) and sends its shapes; done all at once at a cut, that was a freeze of up
// to two seconds on a phone. Here, a few milliseconds a frame:
//   1. pictures, one at a time (renderer.initTexture), for every scene there is, as soon as they have loaded
//   2. then scene by scene, in the order they're due, small batches of its objects: their shaders built in the background
//      (compileAsync, where the browser can), then drawn once to the screen itself through a one-pixel window, on a camera
//      layer only that batch is on (so the shapes go over and every way of drawing them is set up for the screen as it is;
//      a target of its own would build the wrong shader variants), before the frame paints over it
// A batch is as many objects as add up to `s.verts` points of shape (doubled while drawing is quick, halved when slow), so
// one big mesh goes alone. A finished scene is looked over again now and then (one scene every few seconds), and anything
// new in it (a model that loaded later) gets the same.
//
//   const W = warmQueue(renderer)
//   W.add({ name, roots: () => [objects], scene: () => scene, camera: () => camera, ready: () => bool, due: seconds })
//     roots: what belongs to the scene (searched through, hidden things too); scene: what it's drawn in (its lights);
//     camera: the one it's drawn with; ready: when its objects may be drawn (its pictures go before); due: when it's shown;
//     textures (optional): () => more pictures it will need (ones handed to shaders, which only show once those are built);
//     verts (optional): how many points of shape its first batch may send (it learns from there)
//   W.step(ms): this frame's share, before the frame is drawn; W.status(): a line for a readout; W.log: the slowest jobs
import * as THREE from 'three';

const LAYER = 30;                                                     // (the warm-up's own camera layer)
const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'lightMap', 'displacementMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'gradientMap', 'envMap', 'matcap'];

export function warmQueue(renderer) {
  const sets = [], warmed = new WeakSet(), sent = new WeakMap(), cam = new THREE.PerspectiveCamera(), log = [];
  let lastScan = 0, scanAt = 0;
  const serial = !renderer.extensions.has('KHR_parallel_shader_compile');   // (no building shaders in the background: each new one's link is waited on at its first draw)
  const weight = (o) => (o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 4) + (o.isInstancedMesh ? o.count * 4 : 0);   // (points of shape to send, and an instance's matrix)
  const now = () => performance.now();
  const materialsOf = (o) => [].concat(o.material || []);
  // a material's pictures: its maps, and any picture among a shader's uniforms (not pictures drawn on the card itself)
  function texturesOf(objs) {
    const out = new Set();
    for (const o of objs) for (const m of materialsOf(o)) {
      for (const k of TEX_KEYS) if (m[k] && m[k].isTexture) out.add(m[k]);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) out.add(u.value);
    }
    return [...out].filter((t) => !t.isRenderTargetTexture && !t.isVideoTexture);
  }
  // the pictures a material's built shader reads: three keeps the shader's whole uniform list once it's built, the pictures
  // a material is handed in its onBeforeCompile among them (the ground's maps, which its own fields don't show)
  const shaderTextures = (objs) => { const out = new Set(); for (const o of objs) for (const m of materialsOf(o)) { const u = renderer.properties.get(m).uniforms; if (u) for (const v of Object.values(u)) if (v && v.value && v.value.isTexture && !v.value.isRenderTargetTexture) out.add(v.value); } return [...out]; };
  const drawables = (roots) => { const out = []; for (const r of roots) if (r) r.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.material) out.push(o); }); return out; };
  // waiting to be sent: loaded (it has a picture and a version) and not on the card at this version yet (nor sent by us at it)
  const unsent = (t) => sent.get(t) !== t.version && t.image && t.version > 0 && renderer.properties.get(t).__version !== t.version;
  // each object, and every hidden one above it, shown and not culled for the length of `fn` (then put back as it was)
  function revealed(objs, root, fn) {
    const back = [];
    for (const o of objs) {
      back.push([o, 'frustumCulled', o.frustumCulled]); o.frustumCulled = false;
      for (let a = o; a && a !== root; a = a.parent) if (!a.visible) { back.push([a, 'visible', false]); a.visible = true; }
      if (root && !root.visible) { back.push([root, 'visible', false]); root.visible = true; }
    }
    try { return fn(); } finally { for (let i = back.length - 1; i >= 0; i--) back[i][0][back[i][1]] = back[i][2]; }
  }
  function draw(objs, s) {
    const c = s.camera(); cam.copy(c); cam.layers.set(LAYER);
    const had = objs.map((o) => o.layers.isEnabled(LAYER)); for (const o of objs) o.layers.enable(LAYER);
    const scissor = renderer.getScissorTest(), clear = renderer.autoClear, px = 1 / renderer.getPixelRatio();
    revealed(objs, s.root, () => { renderer.setScissorTest(true); renderer.setScissor(0, 0, px, px); renderer.autoClear = false; renderer.render(s.root, cam); });
    renderer.setScissorTest(scissor); renderer.autoClear = clear;
    objs.forEach((o, i) => { if (!had[i]) o.layers.disable(LAYER); });
  }
  function collect(s) {
    s.root = s.scene(); const roots = s.roots();
    s.objs = drawables(roots).filter((o) => !warmed.has(o));
    s.root.traverse((o) => { if (o.isLight) o.layers.enable(LAYER); });   // (its lights seen by the warm-up's camera too: the same lights, the same shaders)
    s.i = 0; s.verts = s.verts || s.verts0 || 20000; s.fresh = s.fresh || 4; s.pending = null; s.scanned = now();
  }
  const timed = (what, fn) => { const t = now(); fn(); const dt = now() - t; if (dt > 30) { log.push({ what, ms: Math.round(dt) }); if (log.length > 60) log.shift(); } return dt; };
  return {
    log, sets,
    add(set) { sets.push({ ...set, extra: set.textures, textures: undefined, verts0: set.verts, verts: undefined, done: false, objs: null }); sets.sort((a, b) => a.due - b.due); },
    step(budget = 4) {
      const t0 = now(), left = () => budget - (now() - t0);
      // 1. pictures: every unfinished scene's, as they load, one a time while there's time this frame (always at least one)
      for (const s of sets) {
        if (s.done && !(s.textures && s.textures.length)) continue;
        if (s.textures === undefined || now() - (s.texScan || 0) > 1000) { s.textures = [...new Set([...(s.extra ? s.extra() : []), ...texturesOf(drawables(s.roots()))])].filter((t) => t && t.isTexture && !t.isRenderTargetTexture).filter(unsent); s.texScan = now(); }
        while (s.textures.length) { const t = s.textures.shift(); if (!unsent(t)) continue; timed(`${s.name} picture ${t.image.width || '?'}x${t.image.height || '?'}`, () => renderer.initTexture(t)); sent.set(t, t.version); if (left() <= 0) return; }
      }
      // 2. scene by scene, in the order they're due: build a batch's shaders, then (once built) draw it unseen
      for (const s of sets) {
        if (s.done) continue;
        if (!s.ready()) continue;
        if (!s.objs) collect(s);
        while (left() > 0) {
          if (s.pending) { if (!s.pending.ready) return;
            if (!s.pending.tex) s.pending.tex = shaderTextures(s.pending.objs).filter(unsent);   // (its shaders built: their pictures first, one a time)
            if (s.pending.tex.length) { const t = s.pending.tex.shift(); if (unsent(t)) { timed(`${s.name} shader picture ${t.image.width || '?'}x${t.image.height || '?'}`, () => renderer.initTexture(t)); sent.set(t, t.version); } continue; }
            const b = s.pending.objs; s.pending = null;
            const dt = timed(`${s.name} draw ${b.length}`, () => draw(b, s)); for (const o of b) warmed.add(o);
            s.verts = dt < 2 ? Math.min(400000, s.verts * 2) : dt > 8 ? Math.max(5000, s.verts / 2) : s.verts;   // (sized to the time it takes)
            if (serial) s.fresh = dt < 2 ? Math.min(64, s.fresh * 2) : dt > 8 ? Math.max(1, s.fresh >> 1) : s.fresh;   // (and, built at the draw, how many new shaders a batch may need)
            if (dt > 100) log[log.length - 1].objs = b.map((o) => `${o.name || o.type}:${o.material.type}${o.geometry && o.geometry.index ? ':' + Math.round(o.geometry.index.count / 3) : ''}`);   // (which, for the readout)
            continue; }
          if (s.i >= s.objs.length) { s.done = true; s.scanned = now(); break; }
          const b = [], nu = new Set(), inRoot = (o) => { for (let a = o; a; a = a.parent) if (a === s.root) return true; return false; };
          for (let w = 0; s.i < s.objs.length && (b.length === 0 || w + weight(s.objs[s.i]) <= s.verts) && b.length < 64; s.i++) {
            const o = s.objs[s.i]; if (!inRoot(o)) continue;                // (taken out since it was found: its materials may be disposed)
            const ms = serial ? materialsOf(o).filter((m) => !nu.has(m) && !renderer.properties.get(m).currentProgram) : [];
            if (ms.length && b.length && nu.size + ms.length > s.fresh) break;
            for (const m of ms) nu.add(m); w += weight(o); b.push(o);
          }
          if (!b.length) continue;
          const p = { objs: b, ready: false }; s.pending = p;
          const done = () => { p.ready = true; }; setTimeout(done, 3000);   // (and in 3 s whatever happens: a material disposed while three waits on it leaves its promise hanging)
          const c = s.camera();
          timed(`${s.name} shaders ${b.length}`, () => revealed(b, s.root, () => {
            if (renderer.compileAsync) Promise.all(b.map((o) => renderer.compileAsync(o, c, s.root))).then(done, done); else { for (const o of b) renderer.compile(o, c, s.root); done(); }
          }));
        }
        return;                                                        // (one scene at a time)
      }
      // all caught up: a finished scene looked over again for anything new, one every few seconds
      if (now() - scanAt > 3000) { scanAt = now(); const done = sets.filter((s) => s.done && s.ready()); if (done.length) { const s = done[lastScan++ % done.length]; collect(s); if (s.objs.length) { s.done = false; s.textures = undefined; } } }
    },
    status() { return sets.map((s) => `${s.name} ${s.done ? 'ready' : !s.ready() ? (s.textures && s.textures.length ? `pictures ${s.textures.length}` : 'waiting') : s.objs ? `${s.i}/${s.objs.length}` : 'starting'}`).join(' · '); },
  };
}
