// THE STATION. A Tripo generation split into a fixed core and an outer ring that spins for gravity.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { layerMaterial, createLayerUniforms } from '../materials/layeredMaterial.js';
import { panelTexture, gratingTexture, dirtTexture } from '../materials/canvasTextures.js';

// Measured on the Tripo model: the ring's median distance from the station axis, in model units.
export const RING_RADIUS_UNITS = 0.153;
// The ring and six arms. The spire, lower column and hub pieces stay still.
export const DEFAULT_SPINNING = [1, 3, 4, 5, 6, 7, 8, 9, 10, 13, 18, 22, 23, 26];
const G = 9.81;

export class Station extends THREE.Group {
  constructor({ renderer, seed = 1 } = {}) {
    super();
    this.core = new THREE.Group(); this.core.name = 'core';
    this.ring = new THREE.Group(); this.ring.name = 'ring';
    this.add(this.core, this.ring);
    this.parts = new Map();            // part number -> mesh
    this.spinning = true;
    this.timeScale = 1;
    const tex = { panel: panelTexture(seed), grating: gratingTexture(seed + 1), dirt: dirtTexture(seed + 2) };
    if (renderer) {
      const a = renderer.capabilities.getMaxAnisotropy();
      for (const t of Object.values(tex)) t.anisotropy = a;
    }
    this.uniforms = createLayerUniforms(tex);
    this.setRingRadius(1000);
  }

  async load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, onProgress);
    const meshes = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const mesh of meshes) {
      const n = Number(/(\d+)$/.exec(mesh.name)?.[1]);
      const src = mesh.material;
      const mat = new THREE.MeshStandardMaterial({ map: src.map, metalness: 0.35, roughness: 0.62 });
      if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; mat.map.anisotropy = this.uniforms.uPanel.value.anisotropy; }
      layerMaterial(mat, this.uniforms);
      mesh.material = mat;
      mesh.castShadow = mesh.receiveShadow = true;
      // keep each part's placement within the model when it moves under the core or the ring
      mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      (DEFAULT_SPINNING.includes(n) ? this.ring : this.core).add(mesh);
      this.parts.set(n, mesh);
    }
    return this;
  }

  // Scene units are metres: the whole model is scaled so the ring sits at this radius.
  setRingRadius(metres) {
    this.ringRadius = metres;
    const s = metres / RING_RADIUS_UNITS;
    this.scale.setScalar(s);
    this.uniforms.uMetersPerUnit.value = s;
  }

  // One turn per this many seconds gives 1 g at the rim.
  get period() { return 2 * Math.PI * Math.sqrt(this.ringRadius / G); }
  get rimSpeed() { return Math.sqrt(G * this.ringRadius); }

  setSpinning(part, spins) {
    const mesh = this.parts.get(part);
    if (!mesh) return;
    (spins ? this.ring : this.core).attach(mesh);   // attach keeps it where it is on screen
  }
  isSpinning(part) { return this.parts.get(part)?.parent === this.ring; }

  update(dt) {
    if (this.spinning) this.ring.rotation.y += dt * this.timeScale * (2 * Math.PI / this.period);
  }
}
