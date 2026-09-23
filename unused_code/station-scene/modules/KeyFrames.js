import * as THREE from 'three';

class KeyFrames {
  constructor(objects) {
      let extra = 20*(2-objects.camera.aspect);
    this.v = [
      new THREE.Vector3(0, 200, 30 + extra),
      new THREE.Vector3(0, 240, 60),
      new THREE.Vector3(300, 20, 300),
      new THREE.Vector3(300, 0, 317)
    ]
    this.r = [
      new THREE.Vector3(0,0,0),
      new THREE.Vector3(-Math.PI/2,0,0),
      new THREE.Vector3(0,0,0)
    ]
  }
  update (objects, track) {
    let t = (track%10)/10;
    if (track < 3.7) {
      objects.displays.update(track);
    } else if (track < 10) {
      t = 1-(10-track)/6.3;
      objects.camera.position.lerpVectors(this.v[0], this.v[1], t);
      let rotation = new THREE.Vector3().lerpVectors(this.r[0],this.r[1], t);
      objects.camera.rotation.setFromVector3(rotation);
    } else if (track < 20) {
      objects.camera.position.lerpVectors(this.v[1], this.v[2], t);
    } else if (track < 30) {
      objects.camera.position.lerpVectors(this.v[2], this.v[3], t); 
      let rotation = new THREE.Vector3().lerpVectors(this.r[1],this.r[2], t);
      objects.camera.rotation.setFromVector3(rotation);
    }
  }
}

export { KeyFrames };
