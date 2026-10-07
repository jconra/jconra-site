// THE PERFORMANCE READOUT (jconra.com/?perf): a small panel over the film, for finding what makes it stutter on a phone.
// Frames: the rate now, the slowest frame in the last second and the last ten, a strip of recent frame times (the green line
// is 60 fps, the red 20). Loading: downloads still on their way and done (and how much), the loaders' own count. What the
// page says it's doing (the film's time and scene, the town being built, its plants and trees, its warm-up). The renderer:
// draws, triangles, shader programs, pictures and shapes held, the pixel ratio, the graphics card. Every frame over 50 ms is
// logged with the film's time and scene and the page's state then. Tap the panel's title to fold it; Copy report puts it all
// (and the biggest downloads, and the page's own marks: when each thing finished loading) on the clipboard.
//
//   perfHud({ renderer, state, marks }) -> { mark(text), report() }
//     state(): { T, set, phase, town, extra } as the page sees it now (strings or numbers); marks: the page's own list of
//     { at (seconds since the page began), T, text }, kept from before this loaded
import * as THREE from 'three';

export function perfHud({ renderer, state, marks = [] }) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;top:calc(8px + env(safe-area-inset-top, 0px));z-index:50;max-width:min(94vw,380px);padding:6px 8px;'
    + 'background:rgba(0,0,0,.72);color:#d8f3e4;font:11px/1.35 ui-monospace,Menlo,monospace;border:1px solid rgba(53,224,125,.5);border-radius:5px;pointer-events:auto;';
  box.innerHTML = '<div data-k="title" style="color:#35e07d;font-weight:600;cursor:pointer">perf ▾</div><div data-k="body"><canvas width="240" height="36" style="display:block;width:240px;height:36px;margin:3px 0"></canvas>'
    + '<div data-k="lines"></div><div data-k="slow" style="color:#ffb3a1;margin-top:3px"></div>'
    + '<button type="button" style="margin-top:4px;font:600 11px ui-monospace,monospace;background:none;border:1px solid #2f7d55;color:#35e07d;border-radius:4px;padding:3px 8px">Copy report</button><span data-k="note" style="margin-left:6px;color:#8aa3b3"></span></div>';
  document.body.appendChild(box);
  const q = (k) => box.querySelector(`[data-k="${k}"]`), cv = box.querySelector('canvas'), g = cv.getContext('2d');
  q('title').addEventListener('click', () => { const b = q('body'); b.hidden = !b.hidden; q('title').textContent = b.hidden ? 'perf ▸' : 'perf ▾'; });
  for (const ev of ['pointerdown', 'wheel', 'touchstart']) box.addEventListener(ev, (e) => e.stopPropagation());   // (taps on the panel aren't the film's)

  // downloads: those still on their way (fetch, and what three's loaders count), those done (the browser's own list)
  let inFetch = 0; const realFetch = window.fetch.bind(window);
  window.fetch = (...a) => { inFetch++; return realFetch(...a).finally(() => { inFetch--; }); };
  const LM = THREE.DefaultLoadingManager; let lmTotal = 0, lmDone = 0;
  const lmWas = { start: LM.onStart, progress: LM.onProgress };
  LM.onStart = (u, l, t) => { lmDone = l; lmTotal = t; if (lmWas.start) lmWas.start(u, l, t); };
  LM.onProgress = (u, l, t) => { lmDone = l; lmTotal = t; if (lmWas.progress) lmWas.progress(u, l, t); };
  const resources = () => performance.getEntriesByType('resource');

  // the graphics card's name, where the browser tells it
  let gpu = '?'; try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { /* not told */ }
  gpu = String(gpu).replace(/ANGLE \(|\)$|Direct3D.*|vs_.*|, OpenGL.*/g, '').slice(0, 60);

  const frames = [], slow = [], t0 = 0; let last = performance.now(), shown = 0;   // (times from when the page began)
  const now = () => performance.now();
  const safe = () => { try { return state() || {}; } catch (e) { return {}; } };
  function tick() {
    const t = now(), dt = t - last; last = t;
    frames.push([t, dt]); while (frames.length && frames[0][0] < t - 10000) frames.shift();
    if (dt > 50) { const s = safe(); slow.push({ at: (t - t0) / 1000, dt, T: s.T, set: s.set, phase: s.phase, town: s.town }); if (slow.length > 400) slow.shift(); }
    if (t - shown > 250) { shown = t; draw(); }
    requestAnimationFrame(tick);
  }
  const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '-' : (+n).toFixed(d));
  function stats() {
    const t = now(), last1 = frames.filter((f) => f[0] > t - 1000), fps = last1.length, worst1 = Math.max(0, ...last1.map((f) => f[1])), worst10 = Math.max(0, ...frames.map((f) => f[1]));
    const res = resources(), bytes = res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0), lastDone = res.reduce((a, r) => Math.max(a, r.responseEnd), 0);
    const inf = renderer.info, mem = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null, s = safe();
    return { fps, worst1, worst10, res: res.length, bytes, lastDone, inf, mem, s };
  }
  function draw() {
    const { fps, worst1, worst10, res, bytes, lastDone, inf, mem, s } = stats();
    const loading = inFetch + Math.max(0, lmTotal - lmDone);
    q('lines').innerHTML = [
      `<b>${fps} fps</b> · worst 1 s ${fmt(worst1)} ms · 10 s ${fmt(worst10)} ms`,
      `film ${fmt(s.T, 1)} s · ${s.set || '-'}${s.phase ? ' · ' + s.phase : ''}`,
      `town: ${s.town || '-'}`,
      `loading: ${loading ? `<b style="color:#ffd27a">${loading} on the way</b>` : 'nothing on the way'} · ${res} done, ${fmt(bytes / 1048576, 1)} MB (last at ${fmt(lastDone / 1000, 1)} s)`,
      `${inf.render.calls} draws · ${fmt(inf.render.triangles / 1e6, 2)} M tris · ${inf.programs ? inf.programs.length : '-'} shaders · ${inf.memory.textures} pictures · ${inf.memory.geometries} shapes`,
      `pixel ratio ${fmt(renderer.getPixelRatio(), 2)} (screen ${fmt(devicePixelRatio, 2)})${mem ? ` · ${fmt(mem)} MB script memory` : ''}${s.extra ? ' · ' + s.extra : ''}`,
      `<span style="color:#8aa3b3">${gpu}</span>`,
    ].join('<br>');
    const recent = slow.slice(-5).reverse().map((f) => `${fmt(f.dt)} ms @ ${fmt(f.T, 1)} s ${f.set || ''}`).join(' · ');
    q('slow').textContent = slow.length ? `long frames: ${slow.length} · ${recent}` : 'no long frames yet';
    // the strip: each frame a bar, 0..100 ms high
    const W = cv.width, H = cv.height, t = now(), win = 4000; g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 0, W, H);
    for (const [ft, d] of frames) { if (ft < t - win) continue; const x = W - (t - ft) / win * W, h = Math.min(H, d / 100 * H); g.fillStyle = d > 50 ? '#ff6b57' : d > 25 ? '#ffd27a' : '#35e07d'; g.fillRect(x, H - h, 1.5, h); }
    for (const [ms, c] of [[16.7, 'rgba(53,224,125,.6)'], [50, 'rgba(255,107,87,.6)']]) { const y = H - ms / 100 * H; g.fillStyle = c; g.fillRect(0, y, W, 1); }
  }
  function report() {
    const { fps, worst10, res, bytes, lastDone, inf, mem, s } = stats();
    const big = resources().slice().sort((a, b) => (b.transferSize || b.encodedBodySize || 0) - (a.transferSize || a.encodedBodySize || 0)).slice(0, 12)
      .map((r) => `  ${fmt((r.transferSize || r.encodedBodySize || 0) / 1024)} KB  ${fmt(r.startTime / 1000, 1)}-${fmt(r.responseEnd / 1000, 1)} s  ${r.name.replace(location.origin, '')}`);
    return [`jconra.com perf report · ${new Date().toISOString()} · ${navigator.userAgent}`, `gpu: ${gpu} · screen ${innerWidth}x${innerHeight} @ ${devicePixelRatio} · pixel ratio ${renderer.getPixelRatio()}`,
      `now: ${fps} fps, worst in 10 s ${fmt(worst10)} ms · film ${fmt(s.T, 1)} s ${s.set} · town: ${s.town}`,
      `renderer: ${inf.render.calls} draws, ${fmt(inf.render.triangles / 1e6, 2)} M tris, ${inf.programs ? inf.programs.length : '-'} shaders, ${inf.memory.textures} pictures, ${inf.memory.geometries} shapes${mem ? `, ${fmt(mem)} MB script` : ''}`,
      `downloads: ${res}, ${fmt(bytes / 1048576, 1)} MB, the last done at ${fmt(lastDone / 1000, 1)} s; biggest:`, ...big,
      `marks (seconds since the page began, film time):`, ...marks.map((m) => `  ${fmt(m.at, 1)} s  film ${fmt(m.T, 1)}  ${m.text}`),
      `long frames over 50 ms (${slow.length}): seconds since the page began, length, film time, scene, town:`, ...slow.map((f) => `  ${fmt(f.at, 1)} s  ${fmt(f.dt)} ms  film ${fmt(f.T, 1)} ${f.set || ''} ${f.phase || ''}  town: ${f.town || ''}`)].join('\n');
  }
  box.querySelector('button').addEventListener('click', async () => {
    const text = report(); let ok = false; try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* no clipboard: shown instead */ }
    q('note').textContent = ok ? 'copied' : '';
    if (!ok) { const ta = document.createElement('textarea'); ta.value = text; ta.rows = 8; ta.style.cssText = 'display:block;width:100%;margin-top:4px;font:10px ui-monospace,monospace'; q('body').appendChild(ta); ta.select(); }
  });
  requestAnimationFrame(tick);
  return { mark(text) { const s = safe(); marks.push({ at: (now() - t0) / 1000, T: s.T, text }); }, report };
}
