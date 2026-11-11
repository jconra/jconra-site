import * as THREE from 'three';
import * as dat from 'dat.gui';
import { rebuildTerrainGeometry } from './terrain.js';

export function setupGUI({ scene, renderer, lights, materialUniforms, water, params, terrainMesh, islandSize, shapeParams }) {
    const { sun, ambient, fill } = lights;
    const { mesh: waterMesh, uniforms: wu } = water;
    const mu = materialUniforms;

    const gui = new dat.GUI({ width: 300 });

    // ── Scene ────────────────────────────────────────────────────────────
    const sceneFolder = gui.addFolder('Scene');
    const sceneP = {
        skyColor: '#' + scene.background.getHexString(),
        fogNear:  scene.fog.near,
        fogFar:   scene.fog.far,
        exposure: renderer.toneMappingExposure,
    };
    sceneFolder.addColor(sceneP, 'skyColor').onChange(v => {
        scene.background.set(v);
        scene.fog.color.set(v);
    });
    sceneFolder.add(sceneP, 'fogNear',  0, 100, 0.5).onChange(v => { scene.fog.near = v; });
    sceneFolder.add(sceneP, 'fogFar',  10, 300, 0.5).onChange(v => { scene.fog.far = v; });
    sceneFolder.add(sceneP, 'exposure', 0.1, 4, 0.05).onChange(v => { renderer.toneMappingExposure = v; });

    // ── Lighting ─────────────────────────────────────────────────────────
    const lightFolder = gui.addFolder('Lighting');
    const lightP = {
        sunIntensity:    sun.intensity,
        sunColor:        '#' + sun.color.getHexString(),
        sunX:            sun.position.x,
        sunY:            sun.position.y,
        sunZ:            sun.position.z,
        ambientIntensity: ambient.intensity,
        fillIntensity:   fill.intensity,
    };
    lightFolder.add(lightP, 'sunIntensity', 0, 6, 0.05).name('Sun Intensity').onChange(v => { sun.intensity = v; });
    lightFolder.addColor(lightP, 'sunColor').name('Sun Color').onChange(v => { sun.color.set(v); });
    lightFolder.add(lightP, 'sunX', -30, 30, 0.5).name('Sun X').onChange(v => { sun.position.setX(v); });
    lightFolder.add(lightP, 'sunY',   0, 40, 0.5).name('Sun Y').onChange(v => { sun.position.setY(v); });
    lightFolder.add(lightP, 'sunZ', -30, 30, 0.5).name('Sun Z').onChange(v => { sun.position.setZ(v); });
    lightFolder.add(lightP, 'ambientIntensity', 0, 3, 0.05).name('Ambient').onChange(v => { ambient.intensity = v; });
    lightFolder.add(lightP, 'fillIntensity',    0, 3, 0.05).name('Fill').onChange(v => { fill.intensity = v; });

    // ── Terrain ──────────────────────────────────────────────────────────
    const terrainFolder = gui.addFolder('Terrain');
    const terrainP = {
        tilingScale:   6.0,
        detailTiling:  24.0,
        fadeStart:     10.0,
        fadeEnd:       40.0,
        litterStrength: 1.0,
    };
    terrainFolder.add(terrainP, 'tilingScale',    1, 20, 0.5).name('Tiling').onChange(v   => { mu.tilingScale.value = v; });
    terrainFolder.add(terrainP, 'detailTiling',   5, 60, 0.5).name('Detail Tiling').onChange(v => { mu.detailTilingScale.value = v; });
    terrainFolder.add(terrainP, 'fadeStart',      1, 40, 0.5).name('Detail Fade Start').onChange(v => { mu.detailFadeStart.value = v; });
    terrainFolder.add(terrainP, 'fadeEnd',       10, 120, 0.5).name('Detail Fade End').onChange(v  => { mu.detailFadeEnd.value = v; });
    terrainFolder.add(terrainP, 'litterStrength', 0, 3, 0.05).name('Litter Blend').onChange(v => { mu.litterStrength.value = v; });
    terrainFolder.add({ litterBrightness: 1.8 },  'litterBrightness', 0.5, 4, 0.05).name('Litter Brightness').onChange(v => { mu.litterBrightness.value = v; });
    terrainFolder.add({ litterTilingScale: 3.0 },  'litterTilingScale', 0.5, 10, 0.25).name('Litter Size').onChange(v => { mu.litterTilingScale.value = v; });

    const blendFolder = terrainFolder.addFolder('Height Blending');
    const blendP = {
        sandHigh:      0.8,
        sandLow:       0.2,
        grassLow:      0.2,
        grassHigh:     1.0,
        grassFadeHigh: 4.5,
        grassFadeLow:  3.5,
        rockLow:       3.0,
        rockHigh:      4.5,
        slopeLow:      0.3,
        slopeHigh:     0.6,
    };
    blendFolder.add(blendP, 'sandHigh',      -1, 4, 0.05).name('Sand High').onChange(v     => { mu.sandHigh.value = v; });
    blendFolder.add(blendP, 'sandLow',       -1, 4, 0.05).name('Sand Low').onChange(v      => { mu.sandLow.value = v; });
    blendFolder.add(blendP, 'grassLow',      -1, 4, 0.05).name('Grass Low').onChange(v     => { mu.grassLow.value = v; });
    blendFolder.add(blendP, 'grassHigh',      0, 6, 0.05).name('Grass High').onChange(v    => { mu.grassHigh.value = v; });
    blendFolder.add(blendP, 'grassFadeHigh',  1, 8, 0.05).name('Grass Fade Hi').onChange(v => { mu.grassFadeHigh.value = v; });
    blendFolder.add(blendP, 'grassFadeLow',   1, 8, 0.05).name('Grass Fade Lo').onChange(v => { mu.grassFadeLow.value = v; });
    blendFolder.add(blendP, 'rockLow',        0, 8, 0.05).name('Rock Low').onChange(v      => { mu.rockLow.value = v; });
    blendFolder.add(blendP, 'rockHigh',       1, 10, 0.05).name('Rock High').onChange(v    => { mu.rockHigh.value = v; });
    blendFolder.add(blendP, 'slopeLow',       0, 1, 0.01).name('Slope Low').onChange(v     => { mu.slopeLow.value = v; });
    blendFolder.add(blendP, 'slopeHigh',      0, 1, 0.01).name('Slope High').onChange(v    => { mu.slopeHigh.value = v; });

    const shapeFolder = terrainFolder.addFolder('Shape');
    const rebuild = () => rebuildTerrainGeometry(terrainMesh.geometry, islandSize, shapeParams);
    shapeFolder.add(shapeParams, 'noiseStrength',  0, 3,   0.05).name('Noise Height').onChange(rebuild);
    shapeFolder.add(shapeParams, 'noiseFreq',      0.1, 2, 0.05).name('Noise Frequency').onChange(rebuild);
    shapeFolder.add(shapeParams, 'bumpStrength',   0, 12,  0.1).name('Bump Strength').onChange(rebuild);
    shapeFolder.add(shapeParams, 'bumpRadius',     0.5, 3, 0.05).name('Bump Radius').onChange(rebuild);
    shapeFolder.add(shapeParams, 'edgeSinkStart',  0.3, 1, 0.01).name('Sink Start').onChange(rebuild);
    shapeFolder.add(shapeParams, 'edgeSinkRate',   0, 15,  0.25).name('Sink Rate').onChange(rebuild);

    const roughFolder = terrainFolder.addFolder('Roughness');
    const roughP = { grass: 0.85, sand: 0.95, rock: 0.75 };
    roughFolder.add(roughP, 'grass', 0, 1, 0.01).onChange(v => { mu.grassRoughness.value = v; });
    roughFolder.add(roughP, 'sand',  0, 1, 0.01).onChange(v => { mu.sandRoughness.value = v; });
    roughFolder.add(roughP, 'rock',  0, 1, 0.01).onChange(v => { mu.rockRoughness.value = v; });

    // ── Water ────────────────────────────────────────────────────────────
    const waterFolder = gui.addFolder('Water');
    const _c = new THREE.Color(wu.colorR.value, wu.colorG.value, wu.colorB.value);
    const waterP = {
        color:         '#' + _c.getHexString(),
        opacity:       wu.opacity.value,
        level:         waterMesh.position.y,
        waveFreqX:     wu.waveFreqX.value,
        waveFreqY:     wu.waveFreqY.value,
        waveSpeedX:    wu.waveSpeedX.value,
        waveSpeedY:    wu.waveSpeedY.value,
        waveAmplitude: wu.waveAmplitude.value,
    };
    waterFolder.addColor(waterP, 'color').onChange(v => {
        const c = new THREE.Color(v);
        wu.colorR.value = c.r;
        wu.colorG.value = c.g;
        wu.colorB.value = c.b;
    });
    waterFolder.add(waterP, 'opacity',        0, 1,    0.01).onChange(v => { wu.opacity.value = v; });
    waterFolder.add(waterP, 'level',         -3, 3,    0.05).name('Water Level').onChange(v => { waterMesh.position.y = v; });
    waterFolder.add(waterP, 'waveFreqX',      0, 2,    0.005).name('Wave Freq X').onChange(v  => { wu.waveFreqX.value = v; });
    waterFolder.add(waterP, 'waveFreqY',      0, 2,    0.005).name('Wave Freq Y').onChange(v  => { wu.waveFreqY.value = v; });
    waterFolder.add(waterP, 'waveSpeedX',     0, 4,    0.05).name('Wave Speed X').onChange(v => { wu.waveSpeedX.value = v; });
    waterFolder.add(waterP, 'waveSpeedY',     0, 4,    0.05).name('Wave Speed Y').onChange(v => { wu.waveSpeedY.value = v; });
    waterFolder.add(waterP, 'waveAmplitude',  0, 3,    0.05).name('Wave Amplitude').onChange(v => { wu.waveAmplitude.value = v; });

    const _dc = new THREE.Color(wu.deepColorR.value, wu.deepColorG.value, wu.deepColorB.value);
    const depthP = {
        deepColor:   '#' + _dc.getHexString(),
        deepOpacity: wu.deepOpacity.value,
        depthStart:  wu.depthStart.value,
        depthEnd:    wu.depthEnd.value,
    };
    waterFolder.addColor(depthP, 'deepColor').name('Deep Color').onChange(v => {
        const c = new THREE.Color(v);
        wu.deepColorR.value = c.r;
        wu.deepColorG.value = c.g;
        wu.deepColorB.value = c.b;
    });
    waterFolder.add(depthP, 'deepOpacity', 0, 1,   0.01).name('Deep Opacity').onChange(v => { wu.deepOpacity.value = v; });
    waterFolder.add(depthP, 'depthStart',  0, 150,  1).name('Depth Start').onChange(v  => { wu.depthStart.value = v; });
    waterFolder.add(depthP, 'depthEnd',    0, 200,  1).name('Depth End').onChange(v    => { wu.depthEnd.value = v; });

    // ── Camera / Player ──────────────────────────────────────────────────
    const camFolder = gui.addFolder('Camera');
    camFolder.add(params, 'camera_distance', 5,  100, 1).name('Distance');
    camFolder.add(params, 'camera_height',   1,   80, 0.5).name('Height');
    camFolder.add(params, 'lookAt_height',   0,   20, 0.5).name('Look At Height');
    camFolder.add(params, 'player_speed',    0.1,  2, 0.05).name('Player Speed');

    return gui;
}
