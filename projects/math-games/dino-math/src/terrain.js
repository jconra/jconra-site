import * as THREE from 'three';

export const defaultShapeParams = {
    noiseStrength: 1.35,
    noiseFreq: 0.5,
    bumpStrength: 7.8,
    bumpRadius: 1.3,
    edgeSinkStart: 0.7,
    edgeSinkRate: 6.0,
};

export function getTerrainHeight(x, z, size = 64, params = defaultShapeParams) {
    return getHeight(x, z, size / 2, params);
}

export function createIslandGeometry(size = 64, segments = 512, params = defaultShapeParams) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    applyHeights(geometry, size / 2, params);
    geometry.computeVertexNormals();
    return geometry;
}

export function rebuildTerrainGeometry(geometry, size, params) {
    applyHeights(geometry, size / 2, params);
    geometry.computeVertexNormals();
}

function applyHeights(geometry, halfSize, params) {
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        positions.setY(i, getHeight(x, z, halfSize, params));
    }
    positions.needsUpdate = true;
}

function getHeight(x, z, halfSize, params) {
    const nx = x / halfSize;
    const nz = z / halfSize;
    const r = Math.sqrt(nx * nx + nz * nz);

    const falloff = Math.max(0, 1.0 - Math.pow(r / 0.85, 3.0));
    const f = params.noiseFreq;
    let h = 0;
    h += fbm(x * 0.08 * f, z * 0.08 * f, 5) * 4.0;
    h += fbm(x * 0.2 * f + 50, z * 0.2 * f + 50, 3) * 1.2;
    h += fbm(x * 0.5 * f + 100, z * 0.5 * f + 100, 2) * 0.3;
    h *= falloff * params.noiseStrength;

    const bump = Math.pow(Math.max(0, 1.0 - r * params.bumpRadius), 2.5);
    h += bump * params.bumpStrength;

    const sink = Math.max(0, r - params.edgeSinkStart) * params.edgeSinkRate;
    h -= sink;

    return h;
}

function fbm(x, y, octaves) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
        value += noise2D(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    return value / maxValue;
}

function noise2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);

    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
}

function hash(x, y) {
    let n = x * 127.1 + y * 311.7;
    n = Math.sin(n) * 43758.5453;
    return n - Math.floor(n);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}
