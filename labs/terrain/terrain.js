// TERRAIN LAB. Techniques games use so a ground texture does not look like it repeats, each one a
// switch, with a split screen: left of the line the plain texture, right of it the techniques.
//   1. Hex-tiling (after Mikkelsen, "Practical Real-Time Hex-Tiling", 2022): the ground is cut
//      into a triangle grid; each grid vertex owns a random shift and turn of the texture, and a
//      pixel blends the three vertices around it by its barycentric weights, sharpened, and
//      optionally tipped toward the brighter sample so the blend follows the picture.
//   2. Large-scale variation: slow noise tints and brightens the ground in big patches.
//   3. A second, larger read of the same texture fading in with distance.
// The ground is MeshStandardMaterial with the map lookup replaced, so it lights like the town.
// The world itself (the land, water, plants, trees, town, people, landmarks, the time of day) is src/valley.js, shared with
// the jconra.com film; this page is the lab round it: the panel, the Build bar's editing, the rain, the views and readouts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeValley, TIER_SET } from '../../src/valley.js';
import { VillageEditor } from '../../src/objects/villageEditor.js';
import { flyKeys } from '../../src/objects/flyKeys.js';
import { chooseTier, saveTier, watchFrames } from '../../src/quality.js';
import { WIND } from '../../src/objects/wind.js';
import { sunDirection, elevationOf } from '../../src/objects/daylight.js';
import { loadPeople } from '../../src/objects/people.js';
import { KIND_INFO, settingsJSON, applySettings } from '../../src/objects/growth.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);

// the tier is picked on a throwaway context first, so the real one can be made without smoothing
// (multisampling) on potato; smoothing can't be changed after a context exists, so a tier switch
// while running keeps whatever the page started with
const QUAL = (() => { const probe = new THREE.WebGLRenderer(); const q = chooseTier(probe); probe.dispose(); probe.forceContextLoss(); return q; })(), TS0 = TIER_SET[QUAL.tier];
const renderer = new THREE.WebGLRenderer({ antialias: !TS0.lite });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, TS0.ratio));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const GL2 = renderer.capabilities.isWebGL2;
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;

const V = await makeValley({ renderer, camera, controls, quality: QUAL, lab: true, live: Q.has('live') });   // (?live: the land worked out here, not loaded from its bake)
// where the land came from, said in the land's own section: its bake, or worked out here and why (a stale bake says so)
if ($('shapeInfo')) $('shapeInfo').textContent = V.BAKE.from === 'baked' ? 'The land: from its bake' + (V.BAKE.why ? ` (${V.BAKE.why})` : '') + '.' : `The land: worked out here (${V.BAKE.why}).`;
const { scene, sky, U, TOWN, PLANT, COVER, GROW, PLANT_KINDS, FAMILY, FOREST, LEAF, LAND, VALLEY, SHAPE, WATER, PAVE, DAY, DL, STONES, LAWN, CALM, FOLK, SHOW, BEAMS, RAIN, TS, TEXTURES, LAYERS, TREE_SPECIES, TOWN_DEFAULT, weights,
  FLOW, SETTLE, WDEPTH, ACC, POND, OUTLETS, Hg, N, SIZE, TEX, heightAt, groundAt, slopeAt, coverGround, buildLand, buildHeights, shapeMesh, fastMesh, baseGrid, erodeSteps, smoothErosion, cutRavines, addCrags, findWater, townLand, paintWater,
  placeCover, placeTrees, placeStones, placeLawn, calmCover, buildPaving, applyPave, paveLater, composePathRoad, tex, setAverages, applyWeights, drawPaths, followShadow, followCover, townRebuildNow } = V;

for (const n of TEXTURES) $('tex').add(new Option(n, n));
$('tex').value = 'grassMed';
// THE PAVING'S builds and the Stone Lab's settings pasted in
for (const [b, sp] of Object.entries(PAVE.builds)) $('paveBuild').add(new Option(`${b} · ${sp.name}${sp.painted ? '' : ' (3D near you)'}`, b));
$('paveBuild').value = PAVE.build; $('paveBuild').addEventListener('change', (e) => { PAVE.build = e.target.value; buildPaving(); });
$('pavePaste').addEventListener('click', async () => {   // the Stone Lab's Copy settings: the look, the stones, and every build
  let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { text = prompt('Paste the Stone Lab settings here') || ''; }
  let o = null; try { o = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!o || typeof o.size !== 'number' || !o.builds) { $('paveNote').textContent = "That isn't Stone Lab settings."; return; }
  for (const k of Object.keys(PAVE)) if (k !== 'build' && k !== 'builds' && typeof o[k] === typeof PAVE[k]) PAVE[k] = o[k];
  for (const b of Object.keys(PAVE.builds)) if (o.builds[b]) for (const k of Object.keys(PAVE.builds[b])) if (k !== 'name' && typeof o.builds[b][k] === typeof PAVE.builds[b][k]) PAVE.builds[b][k] = o.builds[b][k];
  applyPave(); buildPaving();
});
// THE TOWN EDITOR: the Build bar edits the town through it (its history, the copy kept in this browser). After an edit (and a
// short pause) only what the change touched is redone (V.townRebuildNow)
let townTimer = 0;
function townRebuild() {
  clearTimeout(townTimer); const note = $('tNote'); if (note) note.textContent = 'levelling the ground and clearing the plants…';
  townTimer = setTimeout(() => { const t = performance.now(); townRebuildNow(); if (note) note.textContent = `Saved in this browser · ground redone in ${((performance.now() - t) / 1000).toFixed(1)} s`; }, 350);
}
TOWN.editor = new VillageEditor({ village: TOWN.village, camera, controls, dom: renderer.domElement, container: document.createElement('div'), groundAt, scene,   // (its panel is never shown: the Build bar edits the town now, through it)
  roadCanvas: TOWN.canvas, roadChanged: (rect) => { composePathRoad(rect); paveLater(); }, changed: () => townRebuild(), defaultLayout: TOWN_DEFAULT });
{ const on = $('folkOn'), n = $('folkCount');
  if (on) { on.checked = FOLK.on; on.addEventListener('change', () => { FOLK.on = on.checked; if (FOLK.on && !FOLK.lib) loadPeople().then((lib) => { FOLK.lib = lib; }); if (FOLK.town) FOLK.town.group.visible = FOLK.on && !!FOLK.grid; }); }
  if (n) { const go = () => { FOLK.count = +n.value; $('folkCountOut').textContent = n.value; if (FOLK.town) FOLK.town.setCount(FOLK.count); }; n.value = FOLK.count; n.addEventListener('input', go); $('folkCountOut').textContent = n.value; }
  const sz = $('folkSize'), show = () => { $('folkSizeOut').textContent = `${FOLK.size.toFixed(2)}× (a grown-up ${(1.85 * FOLK.size).toFixed(1)} m)`; };
  if (sz) { sz.value = FOLK.size; show(); sz.addEventListener('input', () => { FOLK.size = +sz.value; show(); if (FOLK.town) FOLK.town.setSize(FOLK.size); }); } }   // (the places' gaps follow at the grid's next making: the size is in its signature)

// ── views ─────────────────────────────────────────────────────────────────────
const VIEWS = {
  'Standing': () => { const y = heightAt(0, 40) + 1.7; camera.position.set(0, y, 40); controls.target.set(0, heightAt(0, -60) + 1.2, -60); },
  'Across the field': () => { camera.position.set(-40, heightAt(-40, 120) + 14, 120); controls.target.set(60, heightAt(60, -200), -200); },
  'Hillside': () => { camera.position.set(260, heightAt(260, 260) + 40, 260); controls.target.set(0, 0, 0); },
  'Overhead': () => { camera.position.set(0, 160, 0.1); controls.target.set(0, 0, 0); },
};
for (const [n, f] of Object.entries(VIEWS)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.onclick = () => { f(); controls.update(); }; $('views').appendChild(b); }
VIEWS['Standing'](); controls.update();

// ── the panel ─────────────────────────────────────────────────────────────────
const SL = {
  tile: [v => { U.tile.value = v; }, v => v.toFixed(1) + ' m'],
  hexSize: [v => { U.hexSize.value = v; }, v => v.toFixed(2)],
  hexRot: [v => { U.hexRot.value = THREE.MathUtils.degToRad(v); }, v => Math.round(v) + '°'],
  hexSharp: [v => { U.hexSharp.value = v; }, v => v.toFixed(1)],
  hexBright: [v => { U.hexBright.value = v; }, v => Math.round(v * 100) + '%'],
  macroStr: [v => { U.macroStr.value = v; }, v => Math.round(v * 100) + '%'],
  macroSize: [v => { U.macroSize.value = v; }, v => v + ' m'],
  macroHue: [v => { U.macroHue.value = v; }, v => Math.round(v * 100) + '%'],
  farFrom: [v => { U.farFrom.value = v; }, v => v + ' m'],
  stampDensity: [v => { U.stampDensity.value = v; }, v => Math.round(v * 100) + '% of cells'],
  stampCell: [v => { U.stampCell.value = v; }, v => v.toFixed(2) + ' m'],
  stampSize: [v => { U.stampSize.value = v; }, v => v.toFixed(2) + '×'],
  stampHue: [v => { U.stampHue.value = v; }, v => Math.round(v * 57.3) + '°'],
  stampShade: [v => { U.stampShade.value = v; }, v => Math.round(v * 100) + '%'],
  stampFar: [v => { U.stampFar.value = v; }, v => v + ' m'],
  stampPatch: [v => { U.stampPatch.value = v; }, v => Math.round(v * 100) + '%'],
  stampPatchSize: [v => { U.stampPatchSize.value = v; }, v => v + ' m'],
  stampClump: [v => { U.stampClump.value = v; }, v => Math.round(v * 100) + '%'],
  mixSharp: [v => { U.mixSharp.value = v; }, v => v.toFixed(1)],
  mixHeight: [v => { U.mixHeight.value = v; }, v => v.toFixed(2)],
  mixBreak: [v => { U.mixBreak.value = v; }, v => Math.round(v * 100) + '%'],
  mixBreakSize: [v => { U.mixBreakSize.value = v; }, v => v.toFixed(1) + ' m'],
  steepFrom: [v => { U.steepFrom.value = v; }, v => Math.round(Math.acos(1 - v) * 57.3) + '°'],
  rockFrom: [v => { U.rockFrom.value = v; }, v => Math.round(Math.acos(1 - v) * 57.3) + '°'],
};
// (each starts at the valley's own setting: Jacob's, the tier's stamp distance)
for (const [id, [apply, fmt]] of Object.entries(SL)) { const el = $(id), go = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); }; el.value = id === 'hexRot' ? THREE.MathUtils.radToDeg(U.hexRot.value) : U[id].value; el.addEventListener('input', go); go(); }
for (const [id, on] of Object.entries(TS.checks)) if ($(id)) $(id).checked = on;
for (const [id, key] of [['hexOn', 'hexOn'], ['macroOn', 'macroOn'], ['farOn', 'farOn'], ['grid', 'grid'], ['stampOn', 'stampOn'], ['mixOn', 'mixOn'], ['wWaveOn', 'wWaveOn'], ['coverFar', 'coverFar']]) { const el = $(id), go = () => { U[key].value = el.checked ? 1 : 0; }; el.checked = U[key].value > 0.5; el.addEventListener('change', go); go(); }
$('tex').addEventListener('change', () => { const l = $('layLush'); l.value = $('tex').value; l.dispatchEvent(new Event('change')); });   // the ground picture IS the lush layer
for (const [id, def] of Object.entries(LAYERS)) { const el = $(id); for (const n of TEXTURES) el.add(new Option(n, n)); el.value = def; const go = () => { U[id].value = tex(el.value); setAverages(); }; el.addEventListener('change', go); go(); }
for (const [id, key, fmt] of [['landWet', 'wetDepth', v => v.toFixed(1) + ' m'], ['landEdgeTrees', 'edgeTrees', v => Math.round(v * 100) + '% smaller'], ['landGiants', 'giants', v => Math.round(v * 100) + '%'], ['landGiantSize', 'giantSize', v => v.toFixed(1) + '×'], ['landDry', 'dryHeight', v => v.toFixed(1) + ' m'], ['landForest', 'forest', v => Math.round(v * 100) + '%'], ['landShade', 'shadeReach', v => Math.round(v * TEX) + ' m'], ['landTreeline', 'treeline', v => v + ' m'], ['landShore', 'shore', v => Math.round(v * TEX) + ' m'], ['landHill', 'hillForest', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = LAND[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  el.addEventListener('change', () => { LAND[key] = +el.value; buildLand(); });
}
// COPY SETTINGS: every control in the panel (sliders, boxes, colours, lists) as { id: value }, so a set
// someone tuned by hand can be pasted back and made the defaults; the quality tier comes along to say
// which tier's numbers they were
$('copySettings').addEventListener('click', async () => {
  const out = { tier: QUAL.tier };
  for (const el of document.querySelectorAll('#panel input[id], #panel select[id], aside input[id], aside select[id]')) {
    if (el.id === 'qTier') continue;
    out[el.id] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
  }
  const text = JSON.stringify(out);
  let ok = false; try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* no clipboard: show it instead */ }
  if (ok) $('copyNote').textContent = `Copied ${Object.keys(out).length - 1} settings. Paste them in chat.`;
  else { $('copyNote').textContent = 'Copy this:'; const ta = document.createElement('textarea'); ta.value = text; ta.rows = 4; ta.style.width = '100%'; $('copyNote').after(ta); ta.select(); }
});
// the dirt spots round the paths (live: the shader's)
for (const [id, fmt] of [['spotAmt', v => Math.round(v * 100) + '%'], ['spotSize', v => v.toFixed(1) + ' m'], ['spotSize2', v => v > 0 ? v.toFixed(1) + ' m' : 'none'], ['spotReach', v => Math.round(v * 100) + '%']]) {
  const el = $(id), go = () => { U[id].value = +el.value; $(id + 'Out').textContent = fmt(+el.value); }; el.value = U[id].value; el.addEventListener('input', go); go();
}
// light and shade
for (const [id, key] of [['hillShade', 'hillShade'], ['aoShade', 'aoShade'], ['treeShade', 'treeShade'], ['shoreStr', 'shoreStr'], ['edgeFrom', 'edgeFrom'], ['edgeShade', 'edgeShade'], ['plantShade', 'plantShade']]) {
  const el = $(id), go = () => { U[key].value = +el.value; $(id + 'Out').textContent = Math.round(+el.value * 100) + '%'; }; el.value = U[key].value; el.addEventListener('input', go); go();
}
// the sky's controls
{ const on = () => { sky.uniforms.cloudOn.value = $('cloudsOn').checked ? 1 : 0; sky.mesh.visible = $('cloudsOn').checked; }; $('cloudsOn').addEventListener('change', on); on();
  for (const [id, key, fmt] of [['cloudCover', 'cloudCover', v => Math.round(v * 100) + '%'], ['cloudSoft', 'cloudSoft', v => v.toFixed(2)], ['cloudScale', 'cloudScale', v => v + ' m'], ['cloudSpeed', 'cloudSpeed', v => v.toFixed(3)]]) {
    const el = $(id), go = () => { sky.uniforms[key].value = +el.value; $(id + 'Out').textContent = fmt(+el.value); }; el.value = sky.uniforms[key].value; el.addEventListener('input', go); go(); } }
$('mixView').addEventListener('change', e => { U.view.value = +e.target.value; });
$('treesOn').addEventListener('change', e => { if (V.treeForest) V.treeForest.group.visible = e.target.checked; });
$('coverOn').addEventListener('change', e => { COVER.on = e.target.checked; placeCover(); });
// how the plants grow, and each kind's settings
$('gWinner').checked = !!GROW.winner; $('gWinner').addEventListener('change', e => { GROW.winner = e.target.checked; placeCover(); });
for (const [id, key, fmt] of [['gBare', 'bare', v => Math.round(v * 100) + '%'], ['gBareSize', 'bareSize', v => v + ' m'], ['gWetSize', 'wetSize', v => v > 0 ? `${(1 - 0.25 * v).toFixed(2)}× dry … ${(1 + 0.3 * v).toFixed(2)}× wet` : 'off'],
  ['gClumpEdge', 'clumpEdge', v => Math.round(v * 100) + '%'], ['gLonerBare', 'lonerBare', v => Math.round(v * 100) + '%'], ['gLongClear', 'longClear', v => Math.round(v * 100) + '%'], ['gPatchSize', 'patchSize', v => v + ' m'], ['gPatchSharp', 'patchSharp', v => Math.round(v * 100) + '%'], ['gClumpShare', 'clumpShare', v => Math.round(v * 100) + '%'], ['gClumpSize', 'clumpSize', v => v + ' m'],
  ['gClumpCount', 'clumpCount', v => v + ' plants'], ['gLonerShare', 'lonerShare', v => Math.round(v * 100) + '%'], ['gWaterside', 'waterside', v => Math.round(v * 100) + '%'], ['gFertSize', 'fertSize', v => v + ' m'], ['gFert', 'fert', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = GROW[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { GROW[key] = +el.value; placeCover(); });
}
{
  const list = $('kindList'), kindName = (k) => `${KIND_INFO[k].name} <small style="color:#6d7a85">${KIND_INFO[k].hab}</small>`;
  PLANT_KINDS.forEach((K, k) => {
    const row = document.createElement('div'); row.className = 'row'; row.style.gridTemplateColumns = 'auto 1fr auto auto';
    row.innerHTML = `<label class="check" for="kOn${k}" style="margin:0"><input id="kOn${k}" type="checkbox"> ${kindName(k)}</label>`
      + `<select id="kStyle${k}"><option value="patch">patch</option><option value="clump">clump</option><option value="loner">loner</option></select>`
      + `<input id="kSize${k}" type="range" min="0.3" max="2.5" step="0.05" style="width:70px" title="size"><output id="kSize${k}Out"></output>`
      + `<button type="button" id="kOnly${k}" style="grid-column:1/-1;justify-self:start;padding:1px 6px">Only</button>`;
    list.appendChild(row);
    const on = $('kOn' + k), st = $('kStyle' + k), sz = $('kSize' + k);
    on.checked = K.on; st.value = K.style; sz.value = K.size; $('kSize' + k + 'Out').textContent = K.size.toFixed(2) + '×';
    on.addEventListener('change', () => { K.on = on.checked; placeCover(); });
    st.addEventListener('change', () => { K.style = st.value; placeCover(); });
    sz.addEventListener('input', () => { $('kSize' + k + 'Out').textContent = (+sz.value).toFixed(2) + '×'; }); sz.addEventListener('change', () => { K.size = +sz.value; placeCover(); });
    $('kOnly' + k).addEventListener('click', () => { PLANT_KINDS.forEach((O, n) => { O.on = n === k; $('kOn' + n).checked = O.on; }); placeCover(); });
  });
  $('kindsAll').addEventListener('click', () => { PLANT_KINDS.forEach((O, n) => { O.on = true; $('kOn' + n).checked = true; }); placeCover(); });
}
// GROWTH SETTINGS in and out (the same text as the Growth Lab's): pasted ones set the panel's controls
// as if moved by hand, but the plants and trees are laid once at the end, not once a control
function syncGrowthPanel() {
  const put = (id, v) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input')); };
  put('gWinner', !!GROW.winner);
  for (const [id, key] of [['gBare', 'bare'], ['gBareSize', 'bareSize'], ['gWetSize', 'wetSize'], ['gClumpEdge', 'clumpEdge'], ['gLonerBare', 'lonerBare'], ['gLongClear', 'longClear'], ['gPatchSize', 'patchSize'], ['gPatchSharp', 'patchSharp'], ['gClumpShare', 'clumpShare'], ['gClumpSize', 'clumpSize'], ['gClumpCount', 'clumpCount'], ['gLonerShare', 'lonerShare'], ['gWaterside', 'waterside'], ['gFertSize', 'fertSize'], ['gFert', 'fert']]) put(id, GROW[key]);
  for (const [id, key] of [['famSize', 'size'], ['famStrict', 'strength'], ['famPine', 'pineFrom']]) put(id, FAMILY[key]);
  PLANT_KINDS.forEach((K, k) => { put('kOn' + k, K.on); put('kStyle' + k, K.style); put('kSize' + k, K.size); });
  put('coverCount', COVER.count); put('coverSize', COVER.size);
}
$('growCopy').addEventListener('click', async () => {
  const text = settingsJSON(GROW, FAMILY, PLANT_KINDS, COVER);
  try { await navigator.clipboard.writeText(text); $('growNote').textContent = 'Copied.'; } catch (e) { $('growNote').textContent = text; }
});
$('growPaste').addEventListener('click', async () => {
  let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { text = prompt('Paste the growth settings here') || ''; }
  if (!applySettings(text, GROW, FAMILY, PLANT_KINDS, COVER)) { $('growNote').textContent = "That isn't growth settings (copy them from the Growth Lab first)."; return; }
  syncGrowthPanel(); placeTrees(); placeCover(); $('growNote').textContent = 'Pasted and applied.';
});
// tree families
for (const [id, key, fmt] of [['famSize', 'size', v => v + ' m'], ['famStrict', 'strength', v => Math.round(v * 100) + '%'], ['famPine', 'pineFrom', v => v + ' m up']]) {
  const el = $(id); el.value = FAMILY[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { FAMILY[key] = +el.value; placeTrees(); });
}
// the breeze and the lawn
$('windOn').checked = WIND.on; $('windOn').addEventListener('change', e => { WIND.on = e.target.checked; if (!WIND.on) WIND.uniforms.windAmp.value = 0; else WIND.uniforms.windAmp.value = +$('windAmp').value; });
for (const [id, key, fmt] of [['windAmp', 'windAmp', v => Math.round(v * 100) + '% lean'], ['windSpeed', 'windSpeed', v => v.toFixed(1)], ['windFreq', 'windFreq', v => Math.round(1 / v) + ' m waves']]) {
  const el = $(id), go = () => { if (key !== 'windAmp' || WIND.on) WIND.uniforms[key].value = +el.value; $(id + 'Out').textContent = fmt(+el.value); }; el.value = WIND.uniforms[key].value; el.addEventListener('input', go); go(); }
for (const [id, obj, key, fmt] of [['lawnAmount', GROW, 'lawn', v => Math.round(v * 100) + '%'], ['lawnDensity', LAWN, 'density', v => v + ' tufts / m²'], ['lawnRadius', LAWN, 'radius', v => v ? v + ' m' : 'off']]) {
  const el = $(id); el.value = obj[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { obj[key] = +el.value; placeLawn(); placeCover(); });
}
$('stonesOn').checked = STONES.on; $('stonesOn').addEventListener('change', e => { STONES.on = e.target.checked; placeStones(); });
for (const [id, key, fmt] of [['stoneCount', 'count', v => v.toLocaleString()], ['stoneSize', 'size', v => v.toFixed(1) + '×'], ['stoneSeen', 'seen', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = STONES[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { STONES[key] = +el.value; placeStones(); });
}
for (const [id, key, fmt] of [['calmAmount', 'amount', v => Math.round(v * 100) + '%'], ['calmFrom', 'from', v => v + ' m'], ['calmTo', 'to', v => v + ' m']]) {
  const el = $(id); el.value = CALM[key]; const go = () => { CALM[key] = +el.value; $(id + 'Out').textContent = fmt(+el.value); calmCover(); }; el.addEventListener('input', go); go();
}
for (const [id, key, fmt] of [['coverCount', 'count', v => v.toLocaleString()], ['coverRadius', 'radius', v => v + ' m'], ['coverSize', 'size', v => v.toFixed(2) + '×'], ['coverNear', 'near', v => v + ' m'], ['coverAhead', 'ahead', v => Math.round(v * 100) + '% ahead'], ['coverFarX', 'farX', v => v.toFixed(1) + '× (sparser, bigger)'], ['coverFade', 'fade', v => `${Math.round(COVER.near * (1 - v / 2))}–${Math.round(COVER.near * (1 + v / 2))} m`]]) {
  const el = $(id); el.value = COVER[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  el.addEventListener('change', () => { COVER[key] = +el.value; placeCover(); });
}
{ // how far into the ground the plants' root clumps go: the meshes at once (each kind its own share, all scaled by this);
  // the far pictures (imposters) are baked with what's under the ground left out, so they're baked again when it's let go
  const el = $('coverSink'), show = () => { $('coverSinkOut').textContent = (+el.value).toFixed(2) + '×'; };
  el.value = COVER.sink; show();
  el.addEventListener('input', () => { show(); COVER.sink = +el.value; if (V.coverForest) V.coverForest.setSinks((sp, i) => KIND_INFO[i].sink * COVER.sink); if (PLANT.tool) PLANT.tool.syncItems(); });
  el.addEventListener('change', () => { if (!V.coverForest) return; for (const sp of V.coverForest.species) { if (sp.bake && sp.bake.targets) sp.bake.targets.forEach((t) => t.dispose()); sp.bake = null; } V.coverForest.imposterAt = -1; placeCover(); });   // (a new forest, its pictures baked afresh)
}
// ── the land's shape: terraces and erosion (these rebuild the land, the maps, trees and plants) ──
// WATCH IT RAIN: the land without erosion, then drops a chunk a frame with their trails drawn and the
// mesh reshaped as they go; when the rain stops the maps, trees and plants are rebuilt on the result
// ── the land's shape: terraces and erosion (these rebuild the land, the maps, trees and plants) ──
// WATCH IT RAIN: the land without erosion, then drops a chunk a frame with their trails drawn and the
// mesh reshaped as they go; when the rain stops the maps, trees and plants are rebuilt on the result (RAIN: the valley's)
const trailGeo = new THREE.BufferGeometry(), trailLines = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({ color: 0x5fb4ff, transparent: true, opacity: 0.55 }));
trailLines.frustumCulled = false; trailLines.visible = false; scene.add(trailLines);
function endRain(msg) { RAIN.gen = null; trailLines.visible = false; if (RAIN.before) smoothErosion(RAIN.before); cutRavines(Hg); addCrags(Hg); findWater(Hg); townLand(); fastMesh(); buildLand(); if (V.treeForest) V.treeForest.group.visible = $('treesOn').checked; $('shapeInfo').textContent = msg; }
function startRain() {
  TOWN.job = null;                                                      // (a town rebuild in slices is for the land as it was)
  FLOW.fill(0); SETTLE.fill(0);
  baseGrid(); RAIN.before = Float32Array.from(Hg);
  WDEPTH.fill(0); ACC.fill(0); paintWater(new Uint8Array(N * N)); fastMesh();   // no water drawn while it rains: the old rivers belong to the finished land, not this bare one
  for (const f of [V.treeForest, V.coverForest]) if (f) f.group.visible = false;
  if (PLANT.tool) PLANT.tool.group.visible = false;
  RAIN.trail = []; RAIN.done = 0; RAIN.paused = false; RAIN.gen = erodeSteps(Hg, SHAPE.drops, () => RAIN.perFrame, RAIN.trail); trailLines.visible = true;
  $('rainPause').textContent = 'pause';
}
function stepRain() {
  if (!RAIN.gen || RAIN.paused) return;
  const r = RAIN.gen.next();
  if (r.done) { endRain(`rained ${SHAPE.drops.toLocaleString()} drops`); return; }
  RAIN.done = r.value;
  const T = RAIN.trail, n = T.length / 3, pos = new Float32Array(n * 3);          // this chunk's trails, just above the ground
  for (let q = 0; q < n; q++) { pos[q * 3] = T[q * 3] * TEX - SIZE / 2 + TEX / 2; pos[q * 3 + 1] = T[q * 3 + 2] + 0.6; pos[q * 3 + 2] = T[q * 3 + 1] * TEX - SIZE / 2 + TEX / 2; }
  trailGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); trailGeo.computeBoundingSphere();
  if (++RAIN.frame % 6 === 0) fastMesh();
  $('shapeInfo').textContent = `raining: ${RAIN.done.toLocaleString()} of ${SHAPE.drops.toLocaleString()} drops`;
}
// the valley's and water's controls: the shape ones rebuild everything, the look ones are live
for (const [id, key, fmt] of [['vHeight', 'height', v => v + ' m'], ['vWidth', 'width', v => v + ' m'], ['vSlope', 'slope', v => v + ' m'], ['vSteep', 'steep', v => v.toFixed(2)], ['vAngle', 'angle', v => v + '°'], ['vMeander', 'meander', v => v + ' m'], ['vFine', 'fine', v => Math.round(v * 100) + '%'], ['vRidges', 'ridges', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = VALLEY[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { VALLEY[key] = +el.value; reshape(); });
}
$('vOn').checked = VALLEY.on; $('vOn').addEventListener('change', e => { VALLEY.on = e.target.checked; reshape(); });
for (const [id, key, fmt] of [['wRiver', 'river', v => Math.round(v * TEX * TEX / 1000).toLocaleString() + ',000 m² gathered'], ['wWidth', 'width', v => v.toFixed(1) + '×'], ['wCarve', 'carve', v => v.toFixed(1) + ' m'], ['wChannel', 'channel', v => Math.round((2 * v + 1) * TEX) + ' m across'], ['wPondDepth', 'pondDepth', v => v.toFixed(2) + ' m'], ['wPondMin', 'pondMin', v => Math.round(v * TEX * TEX) + ' m²'], ['wOutlet', 'outlet', v => v.toFixed(0) + ' m']]) {
  const el = $(id); el.value = WATER[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { WATER[key] = +el.value; reshape(); });
}
$('wOn').checked = WATER.on; $('wOn').addEventListener('change', e => { WATER.on = e.target.checked; U.waterOn.value = WATER.on ? 1 : 0; reshape(); });
for (const [id, key, fmt] of [['wWave', 'wWave', v => v.toFixed(1) + ' m'], ['wSpeed', 'wSpeed', v => v.toFixed(2)], ['wSpec', 'wSpec', v => v.toFixed(2)], ['wReflect', 'wReflect', v => Math.round(v * 100) + '%'], ['wFroth', 'wFroth', v => Math.round(v * 100) + '%']]) {
  const el = $(id), go = () => { U[key].value = +el.value; $(id + 'Out').textContent = fmt(+el.value); }; el.value = U[key].value; el.addEventListener('input', go); go();
}
for (const [id, key] of [['wDeepC', 'wDeep'], ['wShallowC', 'wShallow']]) { const el = $(id); el.value = '#' + U[key].value.clone().convertLinearToSRGB().getHexString(); el.addEventListener('input', () => { U[key].value.set(el.value).convertSRGBToLinear(); }); }
function reshape() { $('shapeInfo').textContent = 'shaping…'; setTimeout(() => { const t0 = performance.now(); buildHeights(); shapeMesh(); buildLand(); $('shapeInfo').textContent = `shaped in ${((performance.now() - t0) / 1000).toFixed(1)} s`; }, 30); }
for (const [id, key] of [['terraceOn', 'terraceOn'], ['erodeOn', 'erodeOn']]) { $(id).checked = SHAPE[key]; $(id).addEventListener('change', e => { SHAPE[key] = e.target.checked; reshape(); }); }
for (const [id, key, fmt] of [['tStep', 'step', v => v.toFixed(1) + ' m'], ['tRiser', 'riser', v => Math.round(v * 100) + '% of a step'], ['tAmount', 'terraceAmount', v => Math.round(v * 100) + '%'], ['tSpread', 'terraceSpread', v => Math.round(v * 100) + '% of the land'], ['tFrom', 'terraceFrom', v => 'steeper than ' + Math.round(Math.atan(v) * 180 / Math.PI) + '°'], ['eDrops', 'drops', v => v.toLocaleString()], ['eStr', 'erodeStrength', v => v.toFixed(2)], ['rPasses', 'ravines', v => v + (v === 1 ? ' pass' : ' passes')], ['rStr', 'ravineStrength', v => v.toFixed(1) + '×'], ['rScale', 'ravineScale', v => 'water gathers on ' + (v * TEX).toFixed(1) + ' m cells'], ['rRound', 'ravineRound', v => Math.round(v * 100) + '%'], ['cCrags', 'crags', v => v + ' m'], ['cCragSize', 'cragSize', v => v + ' m'], ['cCragSharp', 'cragSharp', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = SHAPE[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  el.addEventListener('change', () => { SHAPE[key] = +el.value; reshape(); });
}
$('rainGo').onclick = () => { camera.position.set(0, 520, 420); controls.target.set(0, 0, 0); controls.update(); startRain(); };
$('rainPause').onclick = () => { if (!RAIN.gen) return; RAIN.paused = !RAIN.paused; $('rainPause').textContent = RAIN.paused ? 'go on' : 'pause'; };
$('rainStop').onclick = () => { if (!RAIN.gen) return; while (!RAIN.gen.next().done); endRain('finished'); };
{ const el = $('rainSpeed'), go = () => { RAIN.perFrame = +el.value; $('rainSpeedOut').textContent = (+el.value).toLocaleString() + ' drops a frame'; }; el.addEventListener('input', go); go(); }
for (const [id, key] of [['gullyStr', 'gullyStr'], ['fanStr', 'fanStr'], ['strataStr', 'strataStr']]) { const el = $(id), go = () => { U[key].value = +el.value; $(id + 'Out').textContent = Math.round(+el.value * 100) + '%'; }; el.value = U[key].value; el.addEventListener('input', go); go(); }
for (const [id, key] of [['lushTint', 'lushTint'], ['dampTint', 'dampTint'], ['slopeTint', 'slopeTint']]) { const el = $(id); el.value = '#' + U[key].value.clone().convertLinearToSRGB().getHexString(); el.addEventListener('input', () => { U[key].value.set(el.value).convertSRGBToLinear(); calmCover(); }); }
{ const el = $('strataSize'), go = () => { U.strataSize.value = +el.value; $('strataSizeOut').textContent = (+el.value).toFixed(1) + ' m'; }; el.value = U.strataSize.value; el.addEventListener('input', go); go(); }
// ── the forest's settings: distances apply at once, the atlas and leaf detail re-bake ──
for (const [id, key, fmt, live] of [['fImp', 'imposterAt', v => v + ' m', true], ['fBand', 'band', v => v + ' m', true], ['fAhead', 'ahead', v => Math.round(v * 100) + '% ahead', true], ['fSpread', 'spread', v => '± ' + Math.round(v * 50) + '%', true], ['fGrid', 'grid', v => v + ' × ' + v, false], ['fCell', 'cell', v => v + ' px', false]]) {
  const el = $(id); el.value = FOREST[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); if (live) { FOREST[key] = +el.value; if (V.treeForest) { V.treeForest[key] = FOREST[key]; V.treeForest.assignDirty = true; } } });
  if (!live) el.addEventListener('change', () => { FOREST[key] = +el.value; FOREST.rebake = true; placeTrees(); atlasInfo(); });
}
// one spread for everything that changes with distance: trees, plants, the 3D paving stones, the scattered bits, the lawn's edge
function applySpread() {
  const v = FOREST.spread; if (V.treeForest) V.treeForest.spread = v; if (V.coverForest) { V.coverForest.spread = v; V.coverForest.assignDirty = true; }
  U.stoneSpread.value = v; U.stampSpread.value = v;
}
applySpread(); $('fSpread').addEventListener('input', applySpread); $('fSpread').addEventListener('change', () => { if (typeof placeLawn === 'function') placeLawn(); });
$('fDetail').value = FOREST.detail; $('fDetail').addEventListener('change', e => { FOREST.detail = e.target.value; FOREST.rebake = true; placeTrees(); });
$('fLowPine').checked = FOREST.lowPine; $('fLowPine').addEventListener('change', e => { FOREST.lowPine = e.target.checked; FOREST.rebake = true; placeTrees(); });
$('fShape').value = LEAF.on; $('fShape').addEventListener('change', e => { LEAF.on = e.target.value; FOREST.rebake = true; placeTrees(); });
$('fShapePaste').addEventListener('click', async () => {   // the Foliage Lab's Copy settings
  let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { text = prompt('Paste the Foliage Lab settings here') || ''; }
  let o = null; try { o = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!o || typeof o.lump !== 'number') { $('fShapeNote').textContent = "That isn't Foliage Lab settings."; return; }
  for (const k of ['lump', 'mix', 'dark', 'tip', 'olive', 'branchDark', 'under', 'glow', 'soften']) if (typeof o[k] === 'number') LEAF[k] = o[k];
  if (LEAF.on === 'off') { LEAF.on = o.species === 'pine' ? 'pine' : 'all'; $('fShape').value = LEAF.on; }
  $('fShapeNote').textContent = 'Pasted.'; FOREST.rebake = true; placeTrees(); });
function atlasInfo() { const e = FOREST.grid * FOREST.cell, mb = e * e * 4 / 1048576; $('fAtlasInfo').textContent = `each species: a ${e} × ${e} atlas, ${mb.toFixed(0)} MB colour + ${mb.toFixed(0)} MB normal and depth; ${TREE_SPECIES.length} species = ${(mb * 2 * TREE_SPECIES.length).toFixed(0)} MB. Plants: 8 × 8 of 128 px, 8 MB each.`; }
atlasInfo();
// the atlas viewer: one species' colour atlas in the corner
const atlasCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1), atlasScene = new THREE.Scene(), atlasQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }));
atlasQuad.position.z = -0.5; atlasScene.add(atlasQuad);
function atlasChoices() { const el = $('fAtlasOf'), v = el.value; el.innerHTML = ''; for (const f of [V.treeForest, V.coverForest]) if (f) for (const sp of f.species) el.add(new Option(sp.name, sp.name)); if (v) el.value = v; }
$('fAtlasOf').addEventListener('focus', atlasChoices);
function drawAtlas() {
  if (!$('fAtlasOn').checked) return;
  const name = $('fAtlasOf').value; let sp = null; for (const f of [V.treeForest, V.coverForest]) if (f) for (const x of f.species) if (x.name === name) sp = x;
  if (!sp || !sp.bake) return;
  atlasQuad.material.map = sp.bake.colour; atlasQuad.material.needsUpdate = true;
  const S = Math.min(innerWidth, innerHeight) * 0.42, px = renderer.getPixelRatio();
  // top left, under the readout
  renderer.setScissorTest(true); const y = innerHeight - S - 64; renderer.setViewport(12, y, S, S); renderer.setScissor(12, y, S, S); renderer.autoClear = false; renderer.clearDepth();
  renderer.render(atlasScene, atlasCam); renderer.autoClear = true; renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
}
$('fAtlasOn').addEventListener('change', atlasChoices);
// WHAT COSTS WHAT: a second of frames with each part switched off in turn, from where you are looking
$('profile').onclick = async () => {
  const out = $('profileOut'); out.innerHTML = 'measuring…';
  const second = () => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n * 1000 / (performance.now() - t0)); }; requestAnimationFrame(() => requestAnimationFrame(f)); });
  const toggles = [['everything on', () => {}, () => {}],
    ['no trees', () => V.treeForest && (V.treeForest.group.visible = false), () => V.treeForest && (V.treeForest.group.visible = $('treesOn').checked)],
    ['no plants', () => V.coverForest && (V.coverForest.group.visible = false), () => V.coverForest && (V.coverForest.group.visible = true)],
    ['no stamps', () => { U.stampOn.value = 0; }, () => { U.stampOn.value = $('stampOn').checked ? 1 : 0; }],
    ['no mixing', () => { U.mixOn.value = 0; }, () => { U.mixOn.value = $('mixOn').checked ? 1 : 0; }],
    ['no hex-tiling', () => { U.hexOn.value = 0; }, () => { U.hexOn.value = $('hexOn').checked ? 1 : 0; }],
    ['bare ground', () => { for (const k of ['stampOn', 'mixOn', 'hexOn', 'macroOn', 'farOn']) U[k].value = 0; if (V.treeForest) V.treeForest.group.visible = false; if (V.coverForest) V.coverForest.group.visible = false; },
                    () => { for (const k of ['stampOn', 'mixOn', 'hexOn', 'macroOn', 'farOn']) U[k].value = $(k).checked ? 1 : 0; if (V.treeForest) V.treeForest.group.visible = $('treesOn').checked; if (V.coverForest) V.coverForest.group.visible = true; }]];
  const rows = [];
  for (const [name, off, on] of toggles) { off(); const f = await second(); on(); rows.push(`<div><b>${f.toFixed(0)} fps</b> ${name} <span style="color:#6d7a85">(${(1000 / Math.max(1, f)).toFixed(1)} ms)</span></div>`); }
  out.innerHTML = rows.join('');
};
// the stamps' kinds' weights (V.weights: the valley's, as a running total for the shader to pick by)
const KINDS = ['Leaves', 'Twigs and bark', 'Cones and needles', 'Stones', 'Moss and lichen', 'Mushrooms', 'Small plants', 'Grass tufts'];
const MIXES = {
  'Forest floor': [5, 2, 3, 1, 2, 0.4, 1, 0.5], 'Pine forest': [0.5, 2, 5, 1, 2, 0.3, 0.5, 0.5],
  'Meadow': [0.2, 0.2, 0, 1, 0.5, 0.1, 3, 6], 'Rocky': [0.3, 1, 0.3, 6, 3, 0, 0.3, 1],
};
for (let k = 0; k < 8; k++) {
  const d = document.createElement('div'); d.className = 'row';
  d.innerHTML = `<label for="kind${k}">${KINDS[k]}</label><output id="kind${k}Out"></output><input id="kind${k}" type="range" min="0" max="6" step="0.1">`;
  $('kinds').appendChild(d);
  const el = d.querySelector('input'); el.addEventListener('input', () => { weights[k] = +el.value; $(`kind${k}Out`).textContent = weights[k].toFixed(1); applyWeights(); });
}
const showWeights = () => { for (let k = 0; k < 8; k++) { $(`kind${k}`).value = weights[k]; $(`kind${k}Out`).textContent = weights[k].toFixed(1); } applyWeights(); };
for (const [n, w] of Object.entries(MIXES)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.onclick = () => { weights.splice(0, 8, ...w); showWeights(); }; $('mixes').appendChild(b); }
showWeights();
$('min').onclick = () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; };

// the split line
let splitX = 0.5;
const placeSplit = () => { const on = $('splitOn').checked; $('split').style.display = on ? '' : 'none'; $('split').style.left = (splitX * 100) + '%'; U.split.value = on ? splitX : 0; };
$('splitOn').addEventListener('change', placeSplit); placeSplit();
{ let drag = false; $('split').addEventListener('pointerdown', (e) => { drag = true; $('split').setPointerCapture(e.pointerId); e.stopPropagation(); });
  $('split').addEventListener('pointermove', (e) => { if (!drag) return; splitX = THREE.MathUtils.clamp(e.clientX / innerWidth, 0, 1); placeSplit(); });
  $('split').addEventListener('pointerup', () => { drag = false; }); }

const fit = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); renderer.getDrawingBufferSize(U.res.value); };
addEventListener('resize', fit); fit();   // (and once now: the window may have changed while the valley's files loaded)
// switching tier while running: the panel's controls are set and fired, as if moved by hand
function applyTier(tier) {
  const T = TIER_SET[tier]; renderer.setPixelRatio(Math.min(devicePixelRatio, T.ratio)); renderer.setSize(innerWidth, innerHeight); renderer.getDrawingBufferSize(U.res.value);
  const set = (id, v) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') { if (el.checked !== v) { el.checked = v; el.dispatchEvent(new Event('change')); } } else if (String(el.value) !== String(v)) { el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); } };
  for (const [id, v] of Object.entries(T.checks)) set(id, v);
  for (const [id, k] of [['fImp', 'imposterAt'], ['fBand', 'band'], ['fGrid', 'grid'], ['fCell', 'cell'], ['fDetail', 'detail']]) set(id, T.forest[k]);
  for (const [id, k] of [['coverNear', 'near'], ['coverRadius', 'radius'], ['coverCount', 'count']]) set(id, T.cover[k]);
  set('stampFar', T.u.stampFar);
  set('folkCount', T.people);
}
function showTier() { $('qTier').value = QUAL.source === 'detected' ? 'auto' : QUAL.tier; $('qWhy').textContent = `${QUAL.tier} (${QUAL.source === 'detected' ? 'picked automatically: ' + QUAL.why : QUAL.why})`; }
$('qTier').addEventListener('change', e => { const v = e.target.value; if (v === 'auto') { saveTier(null); location.reload(); return; } saveTier(v); QUAL.tier = v; QUAL.source = 'saved'; QUAL.why = 'your choice'; applyTier(v); showTier(); });
const watch = watchFrames(QUAL, (c) => { applyTier(c.tier); showTier(); });
showTier();
const clock = new THREE.Clock(); let fps = 60, shown = 0; renderer.info.autoReset = false;   // the readout counts the scene, not the atlas viewer
// FLYING: W A S D across, Space up, C down (src/objects/flyKeys.js), faster the higher you are
const fly = flyKeys({ camera, controls, heightAt, speed: 10 });
// the panel: the time (also along the bottom of the page) (and jumps to the moments worth seeing), letting it go by, the time of year, where the sun sets
{ const fmtH = (h) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const elevAt = (h) => elevationOf(sunDirection(h, DAY));
  const when = (side, target) => { if (side === 'noon') return 12; const lo = side === 'rise' ? 0 : 12, hi = side === 'rise' ? 12 : 24;   // (the first time on that side of noon the sun crosses that height)
    let prev = elevAt(lo); for (let h = lo + 0.01; h <= hi; h += 0.01) { const e = elevAt(h); if (side === 'rise' ? (prev < target && e >= target) : (prev > target && e <= target)) return h; prev = e; } return side === 'rise' ? 6 : 19; };
  let last = 0;
  DAY.show = () => { const now = performance.now(); if (DAY.auto && now - last < 250) return; last = now;
    $('dayHour').value = $('dayBarHour').value = DAY.hour; $('dayHourOut').textContent = $('dayBarOut').textContent = fmtH(DAY.hour);
    $('dayNote').textContent = DAY.elev > 0 ? `The sun is ${DAY.elev.toFixed(0)}° up.` : DAY.elev > -6 ? `The sun set ${(-DAY.elev).toFixed(0)}° ago: twilight.` : DAY.elev > -12 ? 'Blue hour going to night.' : 'Night, by the moon.'; };
  for (const id of ['dayHour', 'dayBarHour']) $(id).addEventListener('input', (e) => { DAY.hour = +e.target.value; DAY.dirty = true; });   // (the panel's, and the bar's along the bottom)
  $('dayAuto').checked = DAY.auto; $('dayAuto').addEventListener('change', (e) => { DAY.auto = e.target.checked; });
  for (const [id, key, fmt] of [['dayLen', 'dayMin', (v) => `${v} min`], ['daySeason', 'season', (v) => `noon sun ${(90 - DAY.lat + 23.44 * v).toFixed(0)}° up`], ['dayTurn', 'turn', (v) => `${v}°`]]) {
    const el = $(id), go = () => { DAY[key] = +el.value; $(id + 'Out').textContent = fmt(+el.value); DAY.dirty = true; }; el.value = DAY[key]; el.addEventListener('input', go); $(id + 'Out').textContent = fmt(DAY[key]); }
  for (const [name, side, target] of [['Sunrise', 'rise', 0], ['Morning', 'rise', 20], ['Noon', 'noon', 0], ['Golden hour', 'set', 6], ['Sunset', 'set', 0.5], ['Dusk', 'set', -4], ['Night', 'set', -20]]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => { DAY.hour = when(side, target); DAY.dirty = true; }; $('dayJumps').appendChild(b); }
  DAY.show();
  $('beamsOn').checked = BEAMS.on; $('beamsOn').addEventListener('change', (e) => { BEAMS.on = e.target.checked; V.beamsReady(); });
  { const el = $('beamStr'), go = () => { BEAMS.strength = +el.value; $('beamStrOut').textContent = Math.round(BEAMS.strength * 100) + '%'; }; el.value = BEAMS.strength; el.addEventListener('input', go); go(); } }
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (dt > 0) fps += (1 / dt - fps) * Math.min(1, dt * 2);
  watch();
  if ((shown += dt) > 0.5) { shown = 0; const inf = renderer.info.render; $('hud').innerHTML = `<b>${Math.round(fps)} fps</b> · ${(1000 / Math.max(1, fps)).toFixed(1)} ms · ${inf.calls} draws · ${(inf.triangles / 1e6).toFixed(2)} M triangles · ${GL2 ? 'WebGL2' : 'WebGL1'}`; }
  renderer.info.reset(); stepRain();
  V.update(dt, () => controls.update());
  if (SHOW.sc) document.body.classList.toggle('showing', SHOW.sc.isOpen);
  fly.update(dt);
  if (PLANT.tool) PLANT.tool.update();
  V.render();
  drawAtlas();
});
if (Q.has('probe')) Object.assign(window, { renderer, __valley: V, __day: { set: (o) => { Object.assign(DAY, o); DAY.dirty = true; }, BEAMS, get baking() { return !!DAY.bake; }, get elev() { return DAY.elev; }, DAY, DL, FOG_DIR: V.FOG_DIR, sky, hemi: V.hemi, sun: V.sun }, __rebuildNow: () => townRebuildNow(), __town: TOWN, renderer_dom: () => renderer.domElement, __Hg: Hg, __POND: POND, __WDEPTH: WDEPTH, __slopeAt: slopeAt, __followShadow: followShadow, __pathCanvas: () => V.pathCanvas, __placeLawn: placeLawn, __followCover: followCover, __cg: coverGround, __K: PLANT_KINDS, __G: GROW, groundShader: () => V.mat.userData.fs, WATER, POND, OUTLETS, reshape, THREE, scene, camera, controls, U, VIEWS, heightAt, LAND, buildLand, getTrees: () => V.trees, COVER, placeCover, getForests: () => [V.treeForest, V.coverForest], __plant: () => PLANT, drawPaths, __lamps: V.LAMPU, __folk: FOLK, __show: SHOW });
