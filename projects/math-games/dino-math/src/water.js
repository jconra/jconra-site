import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, vec3, sin, time, uniform, smoothstep, mix, positionWorld, positionLocal } from 'three/tsl';

export function createWater() {
    const material = new MeshStandardNodeMaterial();
    material.transparent = true;

    const uniforms = {
        colorR:        uniform(0.1),
        colorG:        uniform(0.3),
        colorB:        uniform(0.5),
        opacity:       uniform(0.7),
        waveFreqX:     uniform(0.15),
        waveFreqY:     uniform(0.12),
        waveSpeedX:    uniform(0.8),
        waveSpeedY:    uniform(0.6),
        waveAmplitude: uniform(0.3),
        deepColorR:    uniform(0.02),
        deepColorG:    uniform(0.06),
        deepColorB:    uniform(0.18),
        deepOpacity:   uniform(1.0),
        depthStart:    uniform(18.0),
        depthEnd:      uniform(62.0),
    };

    const dist = positionWorld.xz.length();
    const depthT = smoothstep(uniforms.depthStart, uniforms.depthEnd, dist);

    // Vertex displacement — uses world XZ so frequency is in world-space units
    const waveOffset = sin(positionLocal.x.mul(uniforms.waveFreqX).add(time.mul(uniforms.waveSpeedX)))
        .mul(sin(positionLocal.z.mul(uniforms.waveFreqY).add(time.mul(uniforms.waveSpeedY))))
        .mul(uniforms.waveAmplitude);

    material.positionNode = vec3(positionLocal.x, positionLocal.y.add(waveOffset.mul(depthT)), positionLocal.z);

    const shallowColor = vec3(uniforms.colorR, uniforms.colorG, uniforms.colorB);
    const deepColor = vec3(uniforms.deepColorR, uniforms.deepColorG, uniforms.deepColorB);

    material.colorNode = mix(shallowColor, deepColor, depthT);
    material.opacityNode = mix(uniforms.opacity, uniforms.deepOpacity, depthT);
    material.roughnessNode = float(0.1);
    material.metalnessNode = float(0.0);

    const geometry = new THREE.PlaneGeometry(512, 512, 256, 256);
    geometry.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -0.1;

    return { mesh, uniforms };
}
