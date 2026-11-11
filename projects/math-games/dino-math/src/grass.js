import * as THREE from 'three';

const GRASS_VARIETIES = [
    { color: 0x4e8a1a, minH: 1.2, maxH: 3.5, count: 400, seed: 100 },
    { color: 0x7aaa28, minH: 1.0, maxH: 2.5, count: 400, seed: 200 },
];

export function createGrass(getTerrainHeight, islandSize) {
    const group = new THREE.Group();
    const geometry = buildGrassGeometry();

    for (const variant of GRASS_VARIETIES) {
        const material = new THREE.MeshStandardMaterial({
            color: variant.color,
            roughness: 0.95,
            side: THREE.DoubleSide,
        });

        const positions = findGrassPositions(variant, getTerrainHeight, islandSize);
        const count = positions.length;
        const mesh = new THREE.InstancedMesh(geometry, material, count);

        const matrix = new THREE.Matrix4();
        const rot = new THREE.Matrix4();

        for (let i = 0; i < count; i++) {
            const { x, y, z, scale, rotY } = positions[i];
            rot.makeRotationY(rotY);
            matrix.makeScale(scale, scale, scale);
            matrix.multiply(rot);
            matrix.setPosition(x, y, z);
            mesh.setMatrixAt(i, matrix);
        }

        group.add(mesh);
    }

    return { group };
}

function buildGrassGeometry() {
    const verts = [];
    const indices = [];

    // 3 crossed blade quads, each a tapered rectangle
    for (let b = 0; b < 3; b++) {
        const angle = (b / 3) * Math.PI;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const baseHalf = 0.04;
        const topHalf = 0.008;
        const height = 0.42;
        const lean = 0.18;

        const base = verts.length / 3;
        verts.push(
            -cos * baseHalf,                0,      -sin * baseHalf,
             cos * baseHalf,                0,       sin * baseHalf,
            -cos * topHalf + lean * cos,    height, -sin * topHalf + lean * sin,
             cos * topHalf + lean * cos,    height,  sin * topHalf + lean * sin
        );
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

function findGrassPositions(variant, getTerrainHeight, islandSize) {
    const positions = [];
    const halfSize = islandSize / 2;
    let attempts = 0;
    const maxAttempts = variant.count * 10;

    while (positions.length < variant.count && attempts < maxAttempts) {
        attempts++;
        const x = (seededRandom(attempts * 17.3 + variant.seed) - 0.5) * islandSize * 0.85;
        const z = (seededRandom(attempts * 11.7 + variant.seed + 50) - 0.5) * islandSize * 0.85;

        const height = getTerrainHeight(x, z);
        if (height < variant.minH || height > variant.maxH) continue;

        if (Math.sqrt(x * x + z * z) / halfSize > 0.82) continue;

        const tooClose = positions.some(p => {
            const dx = p.x - x;
            const dz = p.z - z;
            return dx * dx + dz * dz < 0.35;
        });
        if (tooClose) continue;

        positions.push({
            x,
            y: height,
            z,
            scale: 0.6 + seededRandom(attempts * 5.1 + variant.seed) * 0.9,
            rotY: seededRandom(attempts * 9.3 + variant.seed) * Math.PI * 2,
        });
    }

    return positions;
}

function seededRandom(seed) {
    const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}
