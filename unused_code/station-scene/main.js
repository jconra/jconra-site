import * as THREE from 'three'; 
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Controls } from 'controls';
import { OrbitControls } from 'orbit';
import * as MODELS from 'scene_models';
import { default as Stats } from 'stats';
import { Displays } from 'displays';
import { KeyFrames } from 'keyframes';

window.scene = new THREE.Scene(); 
const stats = new Stats()
stats.showPanel(0) // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom)

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.setSize( window.innerWidth, window.innerHeight ); 
document.body.appendChild( renderer.domElement ); 

//scene.add( new THREE.AmbientLight( 0x888888 ) );
const objects = {
  camera: new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 2000 ),
  light: new MODELS.Light(1),
  ship: new MODELS.Ship(),
  pad: new MODELS.Pad(),
  station: new MODELS.Station(),
  stationTop: new MODELS.StationTop(),
  stars: new MODELS.Stars(),
  earth: new MODELS.Earth(),
  taxiLights: new MODELS.TaxiLights(),
  panels: new MODELS.Panels(),
  displays: new Displays() 
}
for (const [key, value] of Object.entries(objects)) {scene.add(value);}
objects.camera.position.set(0,200,30+20*(2-objects.camera.aspect));

const shipControls = new Controls(document.body);
const keyFrames = new KeyFrames(objects);
//const controls = new OrbitControls( objects.camera, renderer.domElement );

let lastCalledTime = performance.now();

function animate() {
  let delta = (performance.now() - lastCalledTime)/1000;
  lastCalledTime = performance.now();
  requestAnimationFrame( animate ); 
  
  
  objects.taxiLights.update(lastCalledTime);
  objects.station.update(delta);
  //controls.update();

  keyFrames.update(objects, shipControls.track);
  if (objects.ship) {shipControls.update(objects.ship.position);}
  stats.update();
  renderer.render( scene, objects.camera ); 
}
stats.begin()
renderer.render(scene, objects.camera)
stats.end()
animate();
