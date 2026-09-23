// EARTH from the NASA Blue Marble maps the old site already used (textures/earth_*): colour, cloud,
// surface relief and a shine map that makes the oceans catch the sun while the land stays matt.
// Ground and cloud shells turn at slightly different rates, so the weather drifts over the land.
//
// It is built to be seen from low orbit through a window, where only a slice of the globe shows.
import * as THREE from 'three';

// The shine map is bright where the surface is glossy; roughness wants the opposite, so it is
// inverted once into a canvas at load.
function invert(image) {
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0);
  g.globalCompositeOperation = 'difference';
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class Earth extends THREE.Group {
  constructor({ radius = 6371000, segments = 96, textures = '/textures/' } = {}) {
    super();
    this.radius = radius;
    const loader = new THREE.TextureLoader();
    const load = (file, srgb) => loader.load(textures + file, (t) => {
      t.wrapS = THREE.RepeatWrapping;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    });

    const ground = new THREE.MeshStandardMaterial({
      map: load('earth_atmos_2048.jpg', true),
      normalMap: load('earth_normal_2048.jpg', false),
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.92, metalness: 0.0,
    });
    loader.load(textures + 'earth_specular_2048.jpg', (t) => {
      ground.roughnessMap = invert(t.image);
      ground.roughness = 1.0;
      ground.needsUpdate = true;
    });
    this.ground = new THREE.Mesh(new THREE.SphereGeometry(1, segments, segments / 2), ground);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.003, segments, segments / 2),
      new THREE.MeshStandardMaterial({
        map: load('earth_clouds_2048.png', true),
        transparent: true, roughness: 1, metalness: 0, depthWrite: false,
      })
    );

    // Air glow: visible only where we look through the edge of the shell, which is where a real
    // atmosphere piles up enough air to see.
    this.air = new THREE.Mesh(
      new THREE.SphereGeometry(1.022, segments, segments / 2),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(0x5aa6ff) }, uStrength: { value: 1.0 } },
        vertexShader: `varying vec3 vN; varying vec3 vV;
          void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying vec3 vN; varying vec3 vV;
          void main() { float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); gl_FragColor = vec4(uColor, rim * uStrength); }`,
      })
    );

    this.add(this.ground, this.clouds, this.air);
    this.setRadius(radius);
    this.spin = 1;            // degrees per second, as seen from the window
  }

  setRadius(metres) {
    this.radius = metres;
    for (const m of [this.ground, this.clouds, this.air]) m.scale.setScalar(metres);
  }

  update(dt) {
    this.ground.rotation.y += THREE.MathUtils.degToRad(this.spin) * dt;
    this.clouds.rotation.y += THREE.MathUtils.degToRad(this.spin * 1.15) * dt;   // weather runs ahead of the ground
  }
}
