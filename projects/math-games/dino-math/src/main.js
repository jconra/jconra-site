import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { createIslandGeometry, getTerrainHeight, defaultShapeParams } from './terrain.js';
import { createProceduralTextures, createTreeDensityMap } from './textures.js';
import { createIslandMaterial } from './material.js';
import { createWater } from './water.js';
import { createTrees, spawnFallingTree } from './trees.js';
import { createGrass } from './grass.js';
import { Game, COLLECT_RADIUS } from './game.js';

let renderer, scene, camera;
let terrainMesh, islandSize, shapeParams;
let game;
let trees = [];
const fallingTrees = [];

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const mouse = { down: false, x: 0, y: 0, sx: 0, sy: 0 };
const keys = [];

const params = {
    camera_distance: 20,
    lookAt_height: 5,
    camera_height: 20,
    player_speed: 0.5,
};

const player = new THREE.Group();

async function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 80, 160);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    camera.position.set(30, 20, 30);

    renderer = new WebGPURenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    document.body.appendChild(renderer.domElement);

    await renderer.init();

    const lights = setupLighting();

    islandSize = 128;
    shapeParams = { ...defaultShapeParams };

    const { group: treeGroup, positions: treePositions, trees: treeData } = createTrees(
        (x, z) => getTerrainHeight(x, z, islandSize, shapeParams), islandSize
    );
    trees = treeData;
    scene.add(treeGroup);

    const densityMap = createTreeDensityMap(treePositions, islandSize);
    const { mesh } = setupTerrain(islandSize, densityMap, shapeParams);
    terrainMesh = mesh;

    const { group: grassGroup } = createGrass(
        (x, z) => getTerrainHeight(x, z, islandSize, shapeParams), islandSize
    );
    scene.add(grassGroup);

    const water = createWater();
    scene.add(water.mesh);

    scene.add(player);
    player.position.y = getTerrainHeight(0, 0, islandSize, shapeParams);
    loadDinosaur();

    game = new Game(
        scene, camera, getElevation, treePositions,
        () => {
            changeAnimation('bite');
            const biteDuration = player.actions?.bite
                ? player.actions.bite.getClip().duration * 1000
                : 800;
            setTimeout(() => changeAnimation(keys.length > 0 || player.target ? 'run' : 'idle'), biteDuration);
        },
        () => player.position
    );
    game.startRound();

    setupEventListeners();

    window.addEventListener('resize', onResize);
    renderer.setAnimationLoop(animate);
}

function loadDinosaur() {
    const loader = new GLTFLoader();
    loader.load('./models/trex.gltf', (gltf) => {
        player.add(gltf.scene);
        gltf.scene.traverse(obj => {
            if (obj.name.startsWith('bn_Head')) player.headBone = obj;
        });
        player.actions = {};
        player.mixer = new THREE.AnimationMixer(player.children[0]);
        gltf.animations.forEach((action) => {
            player.actions[action.name] = player.mixer.clipAction(action);
        });
        if (player.actions.bite) {
            player.actions.bite.setLoop(THREE.LoopOnce, 1);
            player.actions.bite.clampWhenFinished = true;
        }
        player.actions.idle.play();
    });
}

function setupLighting() {
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.5);
    sun.position.set(10, 15, 8);
    sun.castShadow = false;
    scene.add(sun);

    const ambient = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.8);
    scene.add(ambient);

    const fill = new THREE.DirectionalLight(0xaaccff, 0.4);
    fill.position.set(-5, 3, -8);
    scene.add(fill);

    return { sun, ambient, fill };
}

function setupTerrain(size, densityMap, shapeP) {
    const geometry = createIslandGeometry(size, 512, shapeP);
    const textures = createProceduralTextures();
    const { material, uniforms } = createIslandMaterial(textures, densityMap, size);

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    return { material, uniforms, mesh };
}

function getElevation(x, z) {
    return getTerrainHeight(x, z, islandSize, shapeParams);
}

function getPlayerCameraVector() {
    const v = player.position.clone().sub(camera.position);
    v.y = 0;
    return v.normalize();
}

function moveCamera(vec) {
    camera.position.copy(player.position);
    camera.position.sub(vec.clone().multiplyScalar(params.camera_distance));
    camera.position.y = params.camera_height;
    camera.lookAt(player.position.clone().add(new THREE.Vector3(0, params.lookAt_height, 0)));
}

function faceModel(vec) {
    player.lookAt(player.position.clone().add(vec));
    if (keys.length === 1) {
        if (keys.includes('s')) player.rotateY(Math.PI);
        if (keys.includes('a')) player.rotateY(Math.PI / 2);
        if (keys.includes('d')) player.rotateY(-Math.PI / 2);
    } else {
        if (keys.includes('s') && keys.includes('d')) player.rotateY(Math.PI * -0.75);
        if (keys.includes('s') && keys.includes('a')) player.rotateY(Math.PI * 0.75);
        if (keys.includes('w') && keys.includes('d')) player.rotateY(Math.PI * -0.25);
        if (keys.includes('w') && keys.includes('a')) player.rotateY(Math.PI * 0.25);
    }
}

function movePlayer() {
    const vec = getPlayerCameraVector().multiplyScalar(params.player_speed);
    faceModel(vec);
    if (keys.includes('w')) player.position.add(vec);
    if (keys.includes('s')) player.position.sub(vec);
    vec.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    if (keys.includes('a')) player.position.add(vec);
    if (keys.includes('d')) player.position.sub(vec);
    player.target = undefined;
}

function autoMove() {
    const refPos = (player.target.isCoin && player.headBone)
        ? player.headBone.getWorldPosition(new THREE.Vector3())
        : player.position;
    const dx = refPos.x - player.target.x;
    const dz = refPos.z - player.target.z;
    const stopDist = player.target.isCoin ? COLLECT_RADIUS : 0.5;
    if (dx * dx + dz * dz < stopDist * stopDist) {
        player.target = undefined;
        changeAnimation('idle');
        return;
    }
    const pdx = player.position.x - player.target.x;
    const pdz = player.position.z - player.target.z;
    const diff = new THREE.Vector3(pdx, 0, pdz).normalize().multiplyScalar(params.player_speed);
    player.position.sub(diff);
}

function changeAnimation(name) {
    if (!player.actions) return;
    Object.keys(player.actions).forEach((key) => player.actions[key].fadeOut(0.2));
    player.actions[name].reset().fadeIn(0.2).play();
}

function checkClick(e) {
    mouse.down = false;
    if (Math.abs(e.clientX - mouse.sx) < 20 && Math.abs(e.clientY - mouse.sy) < 20) {
        const ndc = new THREE.Vector3(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1,
            0.5
        );
        raycaster.setFromCamera(ndc, camera);
        const coins = game ? game.coinMeshes : [];
        const hits = raycaster.intersectObjects([terrainMesh, ...coins]);
        if (hits.length === 0) return;
        const hit = hits[0];
        const isCoin = coins.includes(hit.object);
        player.target = isCoin
            ? new THREE.Vector3(hit.object.position.x, player.position.y, hit.object.position.z)
            : hit.point.clone();
        player.target.isCoin = isCoin;
        player.target.y = player.position.y;
        player.lookAt(player.target);
        changeAnimation('run');
    }
}

function rotate(x, y) {
    if (mouse.down) {
        const vec = getPlayerCameraVector();
        vec.applyAxisAngle(new THREE.Vector3(0, 1, 0), (mouse.x - x) / 100);
        params.camera_height -= (mouse.y - y) / 10;
        const minH = getElevation(camera.position.x, camera.position.z) + 1;
        if (params.camera_height < minH) params.camera_height = minH;
        moveCamera(vec);
        mouse.x = x;
        mouse.y = y;
    }
}

function setupEventListeners() {
    window.addEventListener('keydown', (e) => {
        if (keys.length === 0) changeAnimation('run');
        if (!keys.includes(e.key)) keys.push(e.key);
    });

    window.addEventListener('keyup', (e) => {
        keys.splice(keys.indexOf(e.key), 1);
        if (keys.length === 0) changeAnimation('idle');
    });

    window.addEventListener('mousedown', (e) => {
        mouse.down = true;
        mouse.x = mouse.sx = e.clientX;
        mouse.y = mouse.sy = e.clientY;
    });

    window.addEventListener('mouseup', (e) => { checkClick(e); });
    window.addEventListener('mousemove', (e) => { rotate(e.clientX, e.clientY); });

    window.addEventListener('touchstart', (e) => {
        mouse.down = true;
        mouse.x = mouse.sx = e.touches[0].clientX;
        mouse.y = mouse.sy = e.touches[0].clientY;
    });

    window.addEventListener('touchmove', (e) => { rotate(e.touches[0].clientX, e.touches[0].clientY); });
    window.addEventListener('touchend', (e) => { checkClick(e.changedTouches[0]); });

    window.addEventListener('wheel', (e) => {
        params.camera_distance += e.deltaY > 0 ? 2 : -2;
        params.camera_distance = Math.max(5, Math.min(100, params.camera_distance));
    });
}

const CRUSH_RADIUS = 1.5;
const FALL_DURATION = 0.65;

function checkTreeCrush() {
    for (const tree of trees) {
        if (tree.crushed) continue;
        const dx = player.position.x - tree.x;
        const dz = player.position.z - tree.z;
        if (dx * dx + dz * dz < CRUSH_RADIUS * CRUSH_RADIUS) crushTree(tree);
    }
}

function crushTree(tree) {
    tree.crushed = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    tree.trunkMesh.setMatrixAt(tree.instanceIndex, zero);
    tree.trunkMesh.instanceMatrix.needsUpdate = true;
    tree.leafMesh.setMatrixAt(tree.instanceIndex, zero);
    tree.leafMesh.instanceMatrix.needsUpdate = true;

    const fallDir = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
    fallDir.y = 0;
    fallDir.normalize();
    const fallAxis = new THREE.Vector3(fallDir.z, 0, -fallDir.x);

    const pivot = spawnFallingTree(tree);
    scene.add(pivot);
    fallingTrees.push({ pivot, fallAxis, elapsed: 0 });
}

function updateFallingTrees(delta) {
    for (const ft of fallingTrees) {
        if (ft.elapsed >= FALL_DURATION) continue;
        ft.elapsed += delta;
        const t = Math.min(ft.elapsed / FALL_DURATION, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        ft.pivot.setRotationFromAxisAngle(ft.fallAxis, eased * Math.PI / 2);
    }
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    const delta = clock.getDelta();

    if (player.mixer) {
        const stunned = game && game.stunned;

        if (!stunned) {
            if (keys.length > 0) movePlayer();
            if (player.target) autoMove();
            if (keys.length > 0 || player.target) checkTreeCrush();
        } else {
            // Wobble the T-Rex left/right and shake camera to sell the "ouch"
            player.rotation.y += Math.sin(performance.now() / 80) * 0.05;
            camera.position.x += (Math.random() - 0.5) * 0.25;
            camera.position.z += (Math.random() - 0.5) * 0.25;
        }

        moveCamera(getPlayerCameraVector());
        player.position.y = getElevation(player.position.x, player.position.z);
        player.mixer.update(delta);

        updateFallingTrees(delta);

        const collectPos = player.headBone
            ? player.headBone.getWorldPosition(new THREE.Vector3())
            : player.position;
        if (game) game.update(collectPos, delta, keys.length > 0 || !!player.target);
    }

    renderer.render(scene, camera);
}

init();
