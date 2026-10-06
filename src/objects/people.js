// PEOPLE: the townsfolk's bodies and how each one is dressed. The characters are Quaternius' modular ones (CC0), prepared
// into models/people/ (one skinned mesh each, weapons gone): every part's colour is in its vertices, with what the part is
// (skin, hair, top, bottom, shoes, hat or pack), so each person gets their own skin and hair colour and their clothes
// turned to their own colours in the vertex shader, from one shared model. The clips come once a skeleton (the women's
// and the men's are built differently): Idle, Idle_Neutral, Walk, Run, Wave, Interact.
//
//   loadPeople(base) -> Promise<lib>        lib.kinds: [{ file, body 'f' | 'm', rare, scene }], lib.clips: { f, m }
//   randomLook(rand, kind) -> look           skin, hair (colours), turn / sat / light: [top, bottom, shoes, hat] (radians,
//                                            times, times); rare characters keep their clothes as made
//   new Person(lib, kind, { look, shade, shadows, kid })
//     .root (place and turn it), .mesh, .play(name, { fade, speed, once }), .update(dt), .setLook(look)
//     shade(shader): the page's own lighting patch (onBeforeCompile), run after the colours' one
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// how fast each skeleton's walk and run go at their own speed (m/s: the planted foot's speed backward, measured in the
// People Lab), so a clip's speed can match how fast its person moves
export const STRIDE = { f: { Walk: 1.055, Run: 2.395 }, m: { Walk: 1.318, Run: 2.994 } };
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const load = (url) => new Promise((ok, bad) => loader.load(url, ok, undefined, bad));

export async function loadPeople(base = '/models/people/') {
  const list = (await (await fetch(base + 'people.json')).json()).people;
  const [kinds, f, m] = await Promise.all([
    Promise.all(list.map(async (k) => ({ ...k, scene: (await load(`${base}${k.file}.glb`)).scene }))),
    load(base + 'anims_f.glb'), load(base + 'anims_m.glb')]);
  return { kinds, clips: { f: f.animations, m: m.animations } };
}

// the colours to choose from (sRGB, as a picker shows them), from light to dark
const SKINS = ['#efcfb8', '#e6bfa1', '#dba982', '#c68d62', '#a96c43', '#8a5232', '#6b3d24', '#4b2a18'];
const HAIRS = ['#16110d', '#2b1d14', '#3f2a1b', '#5c3a22', '#7b4524', '#9c5a2c', '#b98a52', '#d8b878', '#e8dcc0', '#8f8a84', '#cfccc6'];
const DYED = ['#b0306a', '#3a6fd0', '#2f9a6a', '#7a3fc0'];
const col = (s) => new THREE.Color(s);                 // (a style string is read as sRGB and kept in three's linear working space)

export function randomLook(rand, kind) {
  const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
  const punk = /^punk/.test(kind.file);
  const look = { skin: col(pick(SKINS)), hair: col(punk && rand() < 0.5 ? pick(DYED) : pick(HAIRS)), turn: [0, 0, 0, 0], sat: [1, 1, 1, 1], light: [1, 1, 1, 1] };
  if (kind.rare) return look;
  // each group of clothes: most turned to a colour of their own, some left as made; shoes kept quieter
  for (let g = 0; g < 4; g++) {
    if (rand() < 0.8) look.turn[g] = (rand() * 2 - 1) * Math.PI;
    look.sat[g] = g === 2 ? 0.35 + rand() * 0.5 : 0.55 + rand() * 0.55;
    look.light[g] = 0.7 + rand() * 0.6;
  }
  return look;
}

// the colours, worked out a vertex: _kind 0 as made, 1 skin, 2 hair (both stored as how light against the character's
// own, over 2.5), 3..6 the clothes' groups turned round the grey axis (hue), then saturation and lightness scaled
const PERSON_VS = `
  attribute float _kind;
  uniform vec3 fkSkin, fkHair; uniform vec4 fkTurn, fkSat, fkLight;
  vec3 fkHue(vec3 c, float a) { const vec3 k = vec3(0.57735027); float ca = cos(a), sa = sin(a); return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca); }
  vec3 fkColour(vec3 c, float kind) {
    if (kind < 0.5) return c;
    if (kind < 1.5) return fkSkin * (c.r * 2.5);
    if (kind < 2.5) return fkHair * (c.r * 2.5);
    vec4 m = vec4(equal(vec4(floor(kind + 0.5)), vec4(3.0, 4.0, 5.0, 6.0)));
    vec3 t = max(fkHue(c, dot(m, fkTurn)), 0.0); float g = dot(t, vec3(0.2126, 0.7152, 0.0722));
    return max(mix(vec3(g), t, dot(m, fkSat)) * dot(m, fkLight), 0.0);
  }
`;

export class Person {
  constructor(lib, kind, { look, shade = null, shadows = false, kid = false } = {}) {
    this.kind = kind; this.kid = kid;
    this.root = cloneSkinned(kind.scene);
    this.root.traverse((o) => { if (o.isSkinnedMesh) this.mesh = o; });
    const u = this.u = { fkSkin: { value: new THREE.Color() }, fkHair: { value: new THREE.Color() }, fkTurn: { value: new THREE.Vector4() }, fkSat: { value: new THREE.Vector4() }, fkLight: { value: new THREE.Vector4() } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = PERSON_VS + sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb = fkColour(vColor.rgb, _kind);');
      if (shade) shade(sh);
    };
    mat.customProgramCacheKey = () => 'person-1' + (shade ? '-shaded' : '');
    this.mesh.material = mat; this.mesh.castShadow = shadows; this.mesh.receiveShadow = shadows;
    if (look) this.setLook(look);
    // a child: smaller, with a bigger head for its size
    if (kid) { this.root.scale.setScalar(0.6); const head = this.mesh.skeleton.bones.find((b) => b.name === 'Head'); if (head) head.scale.setScalar(1.3); }
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {}; for (const c of lib.clips[kind.body]) this.actions[c.name] = this.mixer.clipAction(c);
    this.cur = null; this.curName = '';
  }
  setLook(l) {
    const u = this.u; this.look = l;
    u.fkSkin.value.copy(l.skin); u.fkHair.value.copy(l.hair); u.fkTurn.value.fromArray(l.turn); u.fkSat.value.fromArray(l.sat); u.fkLight.value.fromArray(l.light);
  }
  // to another clip, faded across; the same one again only changes its speed. once: plays through and holds its last pose
  play(name, { fade = 0.3, speed = 1, once = false } = {}) {
    const a = this.actions[name]; if (!a) return;
    if (this.cur === a) { a.setEffectiveTimeScale(speed); return; }
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
    a.setEffectiveTimeScale(speed).setEffectiveWeight(1).fadeIn(fade).play();
    if (this.cur) this.cur.fadeOut(fade);
    this.cur = a; this.curName = name;
  }
  update(dt) { this.mixer.update(dt); }
  dispose() { this.mesh.material.dispose(); this.mixer.stopAllAction(); }
}
