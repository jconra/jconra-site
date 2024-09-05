import * as THREE from 'three'; 
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

window.scene = new THREE.Scene(); 
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 ); 
camera.position.set( 0, 0, 30 );

const renderer = new THREE.WebGLRenderer();
renderer.shadowMap.enabled = true;
renderer.setSize( window.innerWidth, window.innerHeight ); 
document.body.appendChild( renderer.domElement ); 

/*
const light = new THREE.DirectionalLight( 0xffffff, 0.5 ); // soft white light
light.position.set(0,20,0);
light.castShadow = true;
scene.add( light );
*/

scene.add( new THREE.AmbientLight( 0xffffff, 3 ) );

let mouse = new THREE.Vector2();
var loader = new GLTFLoader();

var canvas = document.getElementById("canvas");
var cw = canvas.width = 2;
var ch = canvas.height = 2;
var ctx = canvas.getContext('2d',{ willReadFrequently: true });

ctx.fillStyle="rgb(65,0,255)";
ctx.fillRect(0, 0, cw, ch);
let imgData = ctx.getImageData(0,0,cw,ch);
let new_data=[255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255];
for (let i=0; i<new_data.length; i++) {imgData.data[i] = new_data[i];}
ctx.putImageData(imgData, 0, 0);

var mapTexture = new THREE.CanvasTexture(canvas);
//mapTexture.magFilter = THREE.NearestFilter;
//mapTexture.minFilter = THREE.NearestFilter;
//mapTexture.generateMipmaps = false;
//mapTexture.premultiplyAlpha = false;
//mapTexture.needsUpdate = true;


let floorGeometry = new THREE.PlaneGeometry(32, 32, 2, 2);
window.customMaterial = new THREE.MeshStandardMaterial({
  onBeforeCompile: (shader) => {

    // storing a reference to the shader object
    window.customMaterial.userData.shader = shader;

    shader.vertexShader = shader.vertexShader.replace(`#include <displacementmap_pars_vertex>`,
    `#include <displacementmap_pars_vertex>
     uniform sampler2D mapTexture;
     varying vec2 vUV;
     flat out vec4 mapData;`);
    shader.vertexShader = shader.vertexShader.replace(`#include <uv_vertex>`,
    `#include <uv_vertex>
     vUV = uv;
     mapData = texture2D( mapTexture, uv);`);
    shader.fragmentShader = shader.fragmentShader.replace(`#include <color_pars_fragment>`,
    `#include <color_pars_fragment>
     uniform sampler2D dirtyTexture, sandyTexture, grassTexture, rockyTexture;
     varying vec2 vUV;
     flat in vec4 mapData;`);
    shader.fragmentShader = shader.fragmentShader.replace(`#include <color_fragment>`,
    `#include <color_fragment>
     diffuseColor = step(0.5, mapData);`);
    shader.uniforms.mapTexture = {value: mapTexture};
  }
});
let floor = new THREE.Mesh(floorGeometry, customMaterial);
floor.position.y = 0;
//floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

renderer.render( scene, camera ); 
