import * as THREE from 'three';

export function createProceduralTextures() {
    return {
        grass: generateGrassTexture(),
        sand: generateSandTexture(),
        rock: generateRockTexture(),
        grassDetail: generateGrassDetailTexture(),
        sandDetail: generateSandDetailTexture(),
        rockDetail: generateRockDetailTexture(),
        leafLitter: generateLeafLitterTexture(),
    };
}

export function createTreeDensityMap(treePositions, islandSize) {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    const falloffRadius = 3.0;

    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const worldX = (px / size - 0.5) * islandSize;
            const worldZ = (py / size - 0.5) * islandSize;

            let density = 0;
            for (const pos of treePositions) {
                const dx = worldX - pos.x;
                const dz = worldZ - pos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < falloffRadius) {
                    const t = 1 - dist / falloffRadius;
                    density += t * t * pos.scale;
                }
            }

            const val = Math.min(1, density) * 255;
            const idx = (py * size + px) * 4;
            data[idx] = val;
            data[idx + 1] = val;
            data[idx + 2] = val;
            data[idx + 3] = 255;
        }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

function generateGrassTexture() {
    const size = 512;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Period P must be an integer; freq = P/size ensures noise(0)==noise(size) → seamless tile
    const P1 = 26,  f1 = P1 / size;  // ≈ 0.05
    const P2 = 102, f2 = P2 / size;  // ≈ 0.2
    const P3 = 410, f3 = P3 / size;  // ≈ 0.8

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const n1 = tn(x * f1,       y * f1,       P1, P1) * 0.5 + 0.5;
            const n2 = tn(x * f2 + 100, y * f2 + 100, P2, P2) * 0.3;
            const n3 = tn(x * f3 + 200, y * f3 + 200, P3, P3) * 0.15;
            const val = n1 + n2 + n3;

            const r = Math.floor(30 + val * 40);
            const g = Math.floor(80 + val * 80);
            const b = Math.floor(20 + val * 30);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    return canvasToTexture(canvas);
}

function generateSandTexture() {
    const size = 512;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const P1 = 51,   f1 = P1 / size;  // ≈ 0.1
    const P2 = 256,  f2 = P2 / size;  // = 0.5
    const P3 = 1024, f3 = P3 / size;  // = 2.0

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const n1 = tn(x * f1,       y * f1,       P1, P1) * 0.3 + 0.7;
            const n2 = tn(x * f2 + 300, y * f2 + 300, P2, P2) * 0.15;
            const n3 = tn(x * f3 + 400, y * f3 + 400, P3, P3) * 0.05;
            const val = n1 + n2 + n3;

            const r = Math.floor(160 + val * 60);
            const g = Math.floor(140 + val * 50);
            const b = Math.floor(80  + val * 40);
            ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    return canvasToTexture(canvas);
}

function generateRockTexture() {
    const size = 512;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const P1 = 20,  f1 = P1 / size;  // ≈ 0.04
    const P2 = 77,  f2 = P2 / size;  // ≈ 0.15
    const P3 = 307, f3 = P3 / size;  // ≈ 0.6
    const P4 = 154, f4 = P4 / size;  // ≈ 0.3

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const n1 = tn(x * f1,       y * f1,        P1, P1) * 0.4 + 0.5;
            const n2 = tn(x * f2 + 500, y * f2 + 500,  P2, P2) * 0.3;
            const n3 = tn(x * f3 + 600, y * f3 + 600,  P3, P3) * 0.1;
            const val = n1 + n2 + n3;

            const base = Math.floor(80 + val * 60);
            const r = base + Math.floor(tn(x * f4, y * f4 + 700, P4, P4) * 15);
            const g = base - 5;
            const b = base - 10;
            ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    return canvasToTexture(canvas);
}

function generateGrassDetailTexture() {
    const size = 256;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const P1 = 128, f1 = P1 / size;  // = 0.5
    const P2 = 512, f2 = P2 / size;  // = 2.0

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const n     = tn(x * f1, y * f1, P1, P1) * 0.5 + 0.5;
            const blade = Math.pow(tn(x * f2, y * f2, P2, P2) * 0.5 + 0.5, 2.0);
            const val   = n * 0.7 + blade * 0.3;

            const gray = Math.floor(100 + val * 100);
            ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    return canvasToTexture(canvas, 4);
}

function generateSandDetailTexture() {
    const size = 256;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const P1 = 256,  f1 = P1 / size;  // = 1.0
    const P2 = 1024, f2 = P2 / size;  // = 4.0
    const P3 = 2048, f3 = P3 / size;  // = 8.0  (grain — replaces Math.random)

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const n1    = tn(x * f1,       y * f1,       P1, P1) * 0.4;
            const n2    = tn(x * f2 + 100, y * f2 + 100, P2, P2) * 0.2;
            const grain = tn(x * f3 + 150, y * f3 + 150, P3, P3) * 0.05 + 0.05;
            const val   = 0.5 + n1 + n2 + grain;

            const gray = Math.floor(val * 200);
            ctx.fillStyle = `rgb(${clamp(gray)},${clamp(gray)},${clamp(gray)})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    return canvasToTexture(canvas, 4);
}

function generateRockDetailTexture() {
    const size = 256;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const P1 = 77,   f1 = P1 / size;  // ≈ 0.3
    const P2 = 384,  f2 = P2 / size;  // = 1.5
    const P3 = 1024, f3 = P3 / size;  // = 4.0

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const cracks = Math.pow(Math.abs(tn(x * f1,       y * f1,       P1, P1)), 3.0);
            const rough  = tn(x * f2 + 200, y * f2 + 200, P2, P2) * 0.3;
            const fine   = tn(x * f3 + 300, y * f3 + 300, P3, P3) * 0.1;
            const val    = 0.5 + rough + fine - cracks * 0.8;

            const gray = Math.floor(clamp(val * 200, 0, 255));
            ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    return canvasToTexture(canvas, 4);
}

function generateLeafLitterTexture() {
    const size = 512;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const P1  = 31,   f1  = P1  / size;  // ≈ 0.06
    const P2  = 128,  f2  = P2  / size;  // = 0.25
    const P3  = 512,  f3  = P3  / size;  // = 1.0
    const P4  = 205,  f4  = P4  / size;  // ≈ 0.4
    // Twig: different periods per axis (anisotropic)
    const P5x = 1536, f5x = P5x / size;  // = 3.0 in x
    const P5y = 154,  f5y = P5y / size;  // ≈ 0.3 in y

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const n1   = tn(x * f1,        y * f1,         P1,  P1)  * 0.4 + 0.5;
            const n2   = tn(x * f2 + 800,  y * f2 + 800,   P2,  P2)  * 0.25;
            const n3   = tn(x * f3 + 900,  y * f3 + 900,   P3,  P3)  * 0.15;
            const leaf = Math.pow(Math.max(0, tn(x * f4 + 1000, y * f4 + 1000, P4, P4)), 2.0) * 0.4;
            const twig = Math.pow(Math.abs(tn(x * f5x,     y * f5y + 1100, P5x, P5y)), 4.0) * 0.2;

            const val = n1 + n2 + n3 + leaf;

            const r = Math.floor(35 + val * 45 + twig * 30);
            const g = Math.floor(30 + val * 35 + leaf * 20);
            const b = Math.floor(15 + val * 20);
            ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    return canvasToTexture(canvas);
}

function canvasToTexture(canvas, repeat = 8) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 16;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// Tileable value noise.
// By wrapping the integer lattice coords with period (px, py), the noise is guaranteed
// periodic: tn(0, y, px, py) == tn(px, y, px, py).  Setting freq = P/textureSize and
// calling tn(pixel * freq, ..., P, P) makes left/right and top/bottom edges match exactly.
function tn(x, y, px, py) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const ax = ((ix     % px) + px) % px;
    const bx = ((ix + 1 % px) + px) % px;
    const ay = ((iy     % py) + py) % py;
    const by = ((iy + 1 % py) + py) % py;

    const a = hash(ax, ay);
    const b = hash(bx, ay);
    const c = hash(ax, by);
    const d = hash(bx, by);

    return mix(mix(a, b, ux), mix(c, d, ux), uy) * 2 - 1;
}

function hash(x, y) {
    let n = x * 127.1 + y * 311.7;
    n = Math.sin(n) * 43758.5453;
    return n - Math.floor(n);
}

function mix(a, b, t) {
    return a + (b - a) * t;
}

function clamp(v, min = 0, max = 255) {
    return Math.max(min, Math.min(max, Math.floor(v)));
}
