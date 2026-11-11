import * as THREE from 'three';

const TREE_VARIETIES = [
    {
        name: 'tall_pine',
        trunkRadius: 0.08,
        trunkLength: 1.8,
        branchAngle: 0.4,
        branchLengthFactor: 0.65,
        branchRadiusFactor: 0.55,
        depth: 4,
        branchesPerLevel: 3,
        upwardBias: 0.3,
        leafSize: 0.4,
        leafDensity: 3,
        trunkColor: 0x4a3520,
        leafColor: 0x2d5a1e,
        scale: 1.2,
        leafShape: 'sphere',
    },
    {
        name: 'broad_oak',
        trunkRadius: 0.12,
        trunkLength: 1.2,
        branchAngle: 0.7,
        branchLengthFactor: 0.7,
        branchRadiusFactor: 0.5,
        depth: 4,
        branchesPerLevel: 4,
        upwardBias: 0.1,
        leafSize: 0.6,
        leafDensity: 4,
        trunkColor: 0x5c3d1e,
        leafColor: 0x3a7a28,
        scale: 1.4,
        leafShape: 'polygon',
        leafSides: 10,
        leafAspectX: 1.5,
        leafAspectZ: 0.55,
    },
    {
        name: 'small_bush',
        trunkRadius: 0.05,
        trunkLength: 0.5,
        branchAngle: 0.9,
        branchLengthFactor: 0.75,
        branchRadiusFactor: 0.6,
        depth: 3,
        branchesPerLevel: 5,
        upwardBias: 0.05,
        leafSize: 0.35,
        leafDensity: 3,
        trunkColor: 0x3d2b15,
        leafColor: 0x4a8a30,
        scale: 0.7,
        leafShape: 'sphere',
    },
    {
        name: 'twisted_birch',
        trunkRadius: 0.06,
        trunkLength: 1.5,
        branchAngle: 0.55,
        branchLengthFactor: 0.6,
        branchRadiusFactor: 0.45,
        depth: 5,
        branchesPerLevel: 2,
        upwardBias: 0.4,
        leafSize: 0.3,
        leafDensity: 2,
        trunkColor: 0x8a8070,
        leafColor: 0xb8e84a,
        scale: 1.0,
        leafShape: 'polygon',
        leafSides: 8,
        leafAspectX: 0.6,
        leafAspectZ: 1.4,
    },
    {
        name: 'palm',
        trunkRadius: 0.07,
        trunkLength: 2.0,
        branchAngle: 1.2,
        branchLengthFactor: 0.5,
        branchRadiusFactor: 0.4,
        depth: 2,
        branchesPerLevel: 6,
        upwardBias: 0.6,
        leafSize: 0.8,
        leafDensity: 1,
        trunkColor: 0x6b5030,
        leafColor: 0x2e6b18,
        scale: 1.3,
        leafShape: 'frond',
        frondCount: 7,
        frondLengthFactor: 2.1,
        frondWidthFactor: 0.13,
    },
];

export function createTrees(getTerrainHeight, islandSize) {
    const group = new THREE.Group();
    const allPositions = [];
    const allTrees = [];
    const instancesPerVariety = 22;

    for (const params of TREE_VARIETIES) {
        const { trunkGeo, leafGeo } = buildTreeGeometry(params);

        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: params.trunkColor,
            roughness: 0.9,
        });
        const leafMaterial = new THREE.MeshStandardMaterial({
            color: params.leafColor,
            roughness: 0.8,
            side: THREE.DoubleSide,
        });

        const positions = findValidPositions(
            instancesPerVariety, getTerrainHeight, islandSize, params
        );
        allPositions.push(...positions);
        const count = positions.length;

        const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMaterial, count);
        const leafInstanced = new THREE.InstancedMesh(leafGeo, leafMaterial, count);

        const matrix = new THREE.Matrix4();
        const rotationMatrix = new THREE.Matrix4();

        for (let i = 0; i < count; i++) {
            const { x, y, z, scale } = positions[i];
            const rotY = seededRandom(x * 100 + z * 77) * Math.PI * 2;
            rotationMatrix.makeRotationY(rotY);
            matrix.makeScale(scale, scale, scale);
            matrix.multiply(rotationMatrix);
            matrix.setPosition(x, y, z);
            trunkInstanced.setMatrixAt(i, matrix);
            leafInstanced.setMatrixAt(i, matrix);

            allTrees.push({
                x, y, z, scale, rotY, params,
                trunkMesh: trunkInstanced,
                leafMesh: leafInstanced,
                instanceIndex: i,
                crushed: false,
            });
        }

        group.add(trunkInstanced);
        group.add(leafInstanced);
    }

    return { group, positions: allPositions, trees: allTrees };
}

export function spawnFallingTree(tree) {
    const { trunkGeo, leafGeo } = buildTreeGeometry(tree.params);

    const trunkMesh = new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({
        color: tree.params.trunkColor,
        roughness: 0.9,
    }));
    const leafMesh = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({
        color: tree.params.leafColor,
        roughness: 0.8,
        side: THREE.DoubleSide,
    }));

    const meshGroup = new THREE.Group();
    meshGroup.scale.setScalar(tree.scale);
    meshGroup.rotation.y = tree.rotY;
    meshGroup.add(trunkMesh);
    meshGroup.add(leafMesh);

    const pivot = new THREE.Group();
    pivot.position.set(tree.x, tree.y, tree.z);
    pivot.add(meshGroup);

    return pivot;
}

function buildTreeGeometry(params) {
    const trunkVertices = [];
    const trunkIndices = [];
    const leafVertices = [];
    const leafIndices = [];

    const origin = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3(0, 1, 0);

    generateBranch(
        origin, direction,
        params.trunkLength, params.trunkRadius,
        params.depth,
        params, trunkVertices, trunkIndices, leafVertices, leafIndices,
        0
    );

    const trunkGeo = buildBufferGeometry(trunkVertices, trunkIndices);
    const leafGeo = buildBufferGeometry(leafVertices, leafIndices);

    return { trunkGeo, leafGeo };
}

function generateBranch(
    start, direction, length, radius, depth,
    params, trunkVerts, trunkIndices, leafVerts, leafIndices,
    seed
) {
    const segments = 5;
    const radialSegments = 6;
    const baseIndex = trunkVerts.length / 3;

    const up = direction.clone().normalize();
    const perp = new THREE.Vector3();
    if (Math.abs(up.y) < 0.99) {
        perp.crossVectors(up, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
        perp.crossVectors(up, new THREE.Vector3(1, 0, 0)).normalize();
    }
    const perp2 = new THREE.Vector3().crossVectors(up, perp).normalize();

    for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const r = radius * (1 - t * 0.7);
        const pos = start.clone().addScaledVector(up, length * t);

        for (let a = 0; a < radialSegments; a++) {
            const angle = (a / radialSegments) * Math.PI * 2;
            const vx = pos.x + (Math.cos(angle) * perp.x + Math.sin(angle) * perp2.x) * r;
            const vy = pos.y + (Math.cos(angle) * perp.y + Math.sin(angle) * perp2.y) * r;
            const vz = pos.z + (Math.cos(angle) * perp.z + Math.sin(angle) * perp2.z) * r;
            trunkVerts.push(vx, vy, vz);
        }

        if (s < segments) {
            for (let a = 0; a < radialSegments; a++) {
                const curr = baseIndex + s * radialSegments + a;
                const next = baseIndex + s * radialSegments + (a + 1) % radialSegments;
                const currUp = curr + radialSegments;
                const nextUp = next + radialSegments;
                trunkIndices.push(curr, next, currUp);
                trunkIndices.push(next, nextUp, currUp);
            }
        }
    }

    const tip = start.clone().addScaledVector(up, length);

    if (depth <= 1) {
        addLeafCluster(tip, params.leafSize, params.leafDensity, leafVerts, leafIndices, seed, params);
        return;
    }

    for (let i = 0; i < params.branchesPerLevel; i++) {
        const childSeed = seed * 13.7 + i * 31.1 + depth * 7.3;
        const rng1 = seededRandom(childSeed);
        const rng2 = seededRandom(childSeed + 0.5);
        const rng3 = seededRandom(childSeed + 1.0);

        const angle = params.branchAngle * (0.7 + rng1 * 0.6);
        const rotAngle = (i / params.branchesPerLevel) * Math.PI * 2 + rng2 * 0.5;

        const newDir = up.clone();
        const axisRotate = perp.clone()
            .multiplyScalar(Math.cos(rotAngle))
            .addScaledVector(perp2, Math.sin(rotAngle));

        newDir.applyAxisAngle(axisRotate, angle);
        newDir.y += params.upwardBias;
        newDir.normalize();

        const childLength = length * params.branchLengthFactor * (0.8 + rng3 * 0.4);
        const childRadius = radius * params.branchRadiusFactor;

        const branchStart = start.clone().addScaledVector(up, length * (0.4 + rng1 * 0.5));

        generateBranch(
            branchStart, newDir, childLength, childRadius, depth - 1,
            params, trunkVerts, trunkIndices, leafVerts, leafIndices,
            childSeed
        );
    }

    addLeafCluster(tip, params.leafSize * 0.5, params.leafDensity - 1, leafVerts, leafIndices, seed + 99, params);
}

function addLeafCluster(center, size, count, verts, indices, seed, params) {
    // Fronds radiate from the cluster center directly — no point scattering
    if (params.leafShape === 'frond') {
        addFrondLeaves(center, size, params, verts, indices, seed);
        return;
    }

    for (let i = 0; i < Math.max(1, count); i++) {
        const rng1 = seededRandom(seed + i * 3.7);
        const rng2 = seededRandom(seed + i * 5.1 + 0.3);
        const rng3 = seededRandom(seed + i * 7.9 + 0.7);

        const offset = new THREE.Vector3(
            (rng1 - 0.5) * size * 0.8,
            (rng2 - 0.3) * size * 0.6,
            (rng3 - 0.5) * size * 0.8
        );

        const pos = center.clone().add(offset);
        const leafScale = size * (0.5 + rng1 * 0.5);

        if (params.leafShape === 'sphere') {
            addSphereLeaf(pos, leafScale, verts, indices);
        } else if (params.leafShape === 'polygon') {
            addPolygonLeaf(pos, leafScale, params, verts, indices, seed + i);
        } else {
            addLeafQuad(pos, leafScale, verts, indices, seed + i);
        }
    }
}

// Low-poly UV sphere merged into the leaf geometry buffer
function addSphereLeaf(center, size, verts, indices) {
    const baseIndex = verts.length / 3;
    const r = size * 0.5;
    const latSegs = 4;
    const lonSegs = 6;

    for (let lat = 0; lat <= latSegs; lat++) {
        const theta = (lat / latSegs) * Math.PI;
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);
        for (let lon = 0; lon <= lonSegs; lon++) {
            const phi = (lon / lonSegs) * Math.PI * 2;
            verts.push(
                center.x + r * sinT * Math.cos(phi),
                center.y + r * cosT,
                center.z + r * sinT * Math.sin(phi)
            );
        }
    }

    const stride = lonSegs + 1;
    for (let lat = 0; lat < latSegs; lat++) {
        for (let lon = 0; lon < lonSegs; lon++) {
            const a = baseIndex + lat * stride + lon;
            const b = a + 1;
            const c = a + stride;
            const d = c + 1;
            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }
}

// Irregular N-gon with per-vertex radius jitter and an aspect ratio stretch
function addPolygonLeaf(center, size, params, verts, indices, seed) {
    const baseIndex = verts.length / 3;
    const sides = params.leafSides || 8;
    const aspectX = params.leafAspectX || 1.0;
    const aspectZ = params.leafAspectZ || 1.0;

    const nx = seededRandom(seed + 1) - 0.5;
    const ny = seededRandom(seed + 2) * 0.5 + 0.5;
    const nz = seededRandom(seed + 3) - 0.5;
    const normal = new THREE.Vector3(nx, ny, nz).normalize();

    const tangent = new THREE.Vector3();
    if (Math.abs(normal.y) < 0.99) {
        tangent.crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
        tangent.crossVectors(normal, new THREE.Vector3(1, 0, 0)).normalize();
    }
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent);

    // Center vertex
    verts.push(center.x, center.y, center.z);

    for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const radiusVar = 0.65 + seededRandom(seed + i * 3.7 + 10) * 0.7;
        const r = size * 0.5 * radiusVar;
        const u = Math.cos(angle) * r * aspectX;
        const v = Math.sin(angle) * r * aspectZ;
        verts.push(
            center.x + tangent.x * u + bitangent.x * v,
            center.y + tangent.y * u + bitangent.y * v,
            center.z + tangent.z * u + bitangent.z * v
        );
    }

    for (let i = 0; i < sides; i++) {
        indices.push(baseIndex, baseIndex + 1 + i, baseIndex + 1 + (i + 1) % sides);
    }
}

// Drooping tapered frond strips radiating from a branch tip
function addFrondLeaves(center, size, params, verts, indices, seed) {
    const frondCount = params.frondCount || 7;
    const frondLength = size * (params.frondLengthFactor || 2.5);
    const frondHalfWidth = size * (params.frondWidthFactor || 0.13);
    const segs = 4;

    for (let i = 0; i < frondCount; i++) {
        const frondSeed = seed + i * 17.3;
        const angleY = (i / frondCount) * Math.PI * 2 + seededRandom(frondSeed) * 0.4;
        const droop = 0.35 + seededRandom(frondSeed + 1) * 0.45;
        const len = frondLength * (0.8 + seededRandom(frondSeed + 2) * 0.4);

        const cosA = Math.cos(angleY);
        const sinA = Math.sin(angleY);
        // Right vector perpendicular to frond direction in XZ plane
        const rx = -sinA;
        const rz = cosA;

        const baseIndex = verts.length / 3;

        for (let s = 0; s <= segs; s++) {
            const t = s / segs;
            const px = center.x + cosA * len * t;
            const py = center.y - droop * len * t * t; // quadratic droop
            const pz = center.z + sinA * len * t;
            const w = frondHalfWidth * (1 - t * 0.85); // taper to tip

            verts.push(px - rx * w, py, pz - rz * w);
            verts.push(px + rx * w, py, pz + rz * w);
        }

        for (let s = 0; s < segs; s++) {
            const a = baseIndex + s * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }
}

function addLeafQuad(center, size, verts, indices, seed) {
    const baseIndex = verts.length / 3;

    const nx = seededRandom(seed + 1) - 0.5;
    const ny = seededRandom(seed + 2) * 0.5 + 0.5;
    const nz = seededRandom(seed + 3) - 0.5;
    const normal = new THREE.Vector3(nx, ny, nz).normalize();

    const tangent = new THREE.Vector3();
    if (Math.abs(normal.y) < 0.99) {
        tangent.crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
        tangent.crossVectors(normal, new THREE.Vector3(1, 0, 0)).normalize();
    }
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent);

    const halfSize = size * 0.5;
    const corners = [
        center.clone().addScaledVector(tangent, -halfSize).addScaledVector(bitangent, -halfSize),
        center.clone().addScaledVector(tangent,  halfSize).addScaledVector(bitangent, -halfSize),
        center.clone().addScaledVector(tangent,  halfSize).addScaledVector(bitangent,  halfSize),
        center.clone().addScaledVector(tangent, -halfSize).addScaledVector(bitangent,  halfSize),
    ];

    for (const c of corners) {
        verts.push(c.x, c.y, c.z);
    }

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
}

function buildBufferGeometry(vertices, indices) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

function findValidPositions(count, getTerrainHeight, islandSize, params) {
    const positions = [];
    const halfSize = islandSize / 2;
    const minHeight = params.name === 'palm' ? 0.2 : 0.8;
    const maxHeight = params.name === 'palm' ? 1.5 : 4.0;
    let attempts = 0;

    while (positions.length < count && attempts < count * 20) {
        attempts++;
        const x = (seededRandom(attempts * 13.1 + params.scale * 100) - 0.5) * islandSize * 0.8;
        const z = (seededRandom(attempts * 7.3 + params.scale * 200) - 0.5) * islandSize * 0.8;

        const height = getTerrainHeight(x, z);
        if (height < minHeight || height > maxHeight) continue;

        const distFromCenter = Math.sqrt(x * x + z * z) / halfSize;
        if (distFromCenter > 0.75) continue;

        const tooClose = positions.some(p => {
            const dx = p.x - x;
            const dz = p.z - z;
            return dx * dx + dz * dz < 2.0;
        });
        if (tooClose) continue;

        const scaleVariation = 0.7 + seededRandom(attempts * 3.3) * 0.6;
        positions.push({
            x,
            y: height,
            z,
            scale: params.scale * scaleVariation,
        });
    }

    return positions;
}

function seededRandom(seed) {
    const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}
