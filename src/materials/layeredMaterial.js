// LAYERED MATERIAL. A generated model spreads a fixed number of texels over its whole surface, so the
// larger it is drawn the blurrier each metre gets. This keeps the model's own texture as the paint job
// and lays repeating canvas tiles over it, so surfaces stay crisp at any distance.
//
//   - Projected from the OBJECT, not the UVs (triplanar). Tripo's UV layouts are messy, and object space
//     means the tiles ride along with anything that moves, like the spinning ring.
//   - Each tile cell is turned by a random quarter turn and shifted by a random half, so the repeat
//     does not read.
//   - A low-frequency noise field decides where grating replaces plating.
//   - The dirt pass multiplies over everything at a larger scale.
//
// Applied to MeshStandardMaterial through onBeforeCompile, which keeps three's own lighting, shadows and
// logarithmic depth chunks intact. Every patched material shares one uniforms object, so one slider
// moves every part at once.
import * as THREE from 'three';

export function createLayerUniforms({ panel, grating, dirt }) {
  return {
    uLayerOn:       { value: 1 },
    uPanel:         { value: panel },
    uGrating:       { value: grating },
    uDirt:          { value: dirt },
    uMetersPerUnit: { value: 1 },     // how many metres one model unit is drawn as
    uTileMeters:    { value: 8 },     // size of one plating tile, in metres
    uHash:          { value: 1 },     // randomise tile rotation and offset
    uPaint:         { value: 0.8 },  // 0 = tiles only, 1 = the model's own colour carrying the tile detail
    uDetail:        { value: 0.9 },   // how strongly the tiles' light and dark show through the paint
    uGrime:         { value: 0.35 },
    uGrateAmount:   { value: 0.62 },  // noise threshold above which grating replaces plating
    uDirtScale:     { value: 2.5 },   // dirt tile size, in plating tiles
  };
}

const VERT_DECL = /* glsl */`
varying vec3 vLayerPos;
varying vec3 vLayerNormal;
`;
const VERT_BODY = /* glsl */`
vLayerPos = transformed;
vLayerNormal = objectNormal;
`;
const FRAG_DECL = /* glsl */`
varying vec3 vLayerPos;
varying vec3 vLayerNormal;
uniform float uLayerOn, uMetersPerUnit, uTileMeters, uHash, uPaint, uDetail, uGrime, uGrateAmount, uDirtScale;
uniform sampler2D uPanel, uGrating, uDirt;

float layerHash2(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
float layerHash3(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.3, 57.7))) * 43758.5453); }
float layerNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(layerHash3(i),                 layerHash3(i + vec3(1,0,0)), f.x),
                 mix(layerHash3(i + vec3(0,1,0)),   layerHash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(layerHash3(i + vec3(0,0,1)),   layerHash3(i + vec3(1,0,1)), f.x),
                 mix(layerHash3(i + vec3(0,1,1)),   layerHash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// One cell of a tile plane: quarter-turned and half-shifted by a hash of the cell it falls in.
vec3 layerCell(sampler2D t, vec2 uv) {
  if (uHash < 0.5) return texture2D(t, uv).rgb;
  vec2 c = floor(uv);
  float h = layerHash2(c);
  vec2 f = fract(uv) - 0.5;
  float r = floor(h * 4.0);
  if (r == 1.0) f = vec2(-f.y, f.x); else if (r == 2.0) f = -f; else if (r == 3.0) f = vec2(f.y, -f.x);
  f += 0.5 + vec2(floor(fract(h * 7.13) * 2.0), floor(fract(h * 3.71) * 2.0)) * 0.5;
  return texture2D(t, f).rgb;
}
vec3 layerTri(sampler2D t, vec3 p, vec3 w) {
  return layerCell(t, p.yz) * w.x + layerCell(t, p.xz) * w.y + layerCell(t, p.xy) * w.z;
}
`;
const FRAG_BODY = /* glsl */`
if (uLayerOn > 0.5) {
  vec3 lp = vLayerPos * uMetersPerUnit / uTileMeters;
  vec3 lw = pow(abs(normalize(vLayerNormal)), vec3(4.0));
  lw /= (lw.x + lw.y + lw.z + 1e-5);
  vec3 plating = layerTri(uPanel, lp, lw);
  vec3 grating = layerTri(uGrating, lp, lw);
  float mask = layerNoise(vLayerPos * uMetersPerUnit / (uTileMeters * 7.0));
  vec3 detail = mix(plating, grating, smoothstep(uGrateAmount - 0.04, uGrateAmount + 0.04, mask));
  vec3 grime = layerTri(uDirt, lp / uDirtScale, lw);
  float lum = dot(detail, vec3(0.299, 0.587, 0.114));
  vec3 painted = diffuseColor.rgb * mix(1.0, lum * 2.2, uDetail);
  vec3 col = mix(detail, painted, uPaint);
  diffuseColor.rgb = col * mix(vec3(1.0), grime, uGrime);
}
`;

export function layerMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_BODY);
  };
  material.customProgramCacheKey = () => 'layered-v1';
  material.needsUpdate = true;
  return material;
}
