import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three'; 
import { Texture } from 'texture';

const textureLoader = new THREE.TextureLoader();

class Light extends THREE.Group {
  constructor(intensity) {
    super();
    this.intensity = intensity;
    this.onCreate();
  }
  onCreate() {
    let light = new THREE.DirectionalLight( 0xffffff, this.intensity );
    light.position.set(-8,50,0)
    light.castShadow = true;
    light.shadow.camera.top = 50;
    light.shadow.camera.bottom = -50;
    light.shadow.camera.left = -50;
    light.shadow.camera.right = 50;
    this.add(light);
    //scene.add(new THREE.CameraHelper( this.light.shadow.camera ));
  }
}

class Ship extends THREE.Group {
  constructor() {
    super();
    this.url = './models/jay.glb'
    this.onCreate();
  }
  onCreate() {
    new GLTFLoader().load( this.url, gltf => {
      this.place(gltf.scene);
      this.add(gltf.scene);
      } 
    );
  }
  place(model) {
    this.scale.set(1.5, 1.5, 1.5);
    this.position.set(300, 0, 300);
    this.rotation.set(0, Math.PI/2, 0);
    model.traverse(child => {
      child.castShadow = true;
    });
  }
}

class Pad extends THREE.Group {
  constructor() {
    super();
    this.texture = new THREE.CanvasTexture((new Texture("pad")).canvas);
    this.geometry = new THREE.PlaneGeometry(50, 50);
    this.material = new THREE.MeshPhongMaterial({ map: this.texture, shininess: 80 });
    this.pad = new THREE.Mesh(this.geometry, this.material);
    this.pad.rotation.x = -Math.PI / 2;
    this.onCreate();
  }
  onCreate() {
    for(let i=0; i<6; i++) {
      let newPad = this.pad.clone();
      let angle = Math.PI/3*i+Math.PI/4;
      newPad.position.set(Math.sin(angle)*425,0,Math.cos(angle)*425);
      newPad.rotation.z = Math.PI/3*i+Math.PI/4;
      this.add(newPad);
    }
    this.position.set(0, -2.45, 0);
    this.traverse(child => {
      child.receiveShadow = true;
    });
  }
}


class Panels extends THREE.Group {
  constructor() {
    super();
    this.texture = new THREE.CanvasTexture((new Texture("panel")).canvas); 
    this.geometry = new THREE.PlaneGeometry( 32, 16 ); 
    this.material = new THREE.MeshPhongMaterial( { map: this.texture, shininess: 80} );
    this.panel = new THREE.Mesh( this.geometry, this.material );
    this.panel.rotation.x = -Math.PI /2;
    this.onCreate();
  }
  onCreate() {
    for(let i=0; i<6; i++) {
      let angle = Math.PI/3*i+Math.PI/4;
      let angle2 = angle+Math.PI/2;
      for(let j=0; j<15; j++) {  
        let x = Math.sin(angle)*(187+j*18);
        let y = Math.cos(angle)*(187+j*18);
        for(let k=-Math.floor(j/3); k<=Math.floor(j/3); k++) {
          if (j>11 && Math.abs(k) < 2 || k==0) continue;
          let newPanel = this.panel.clone();
          let mx = (k<0)? -Math.sin(angle2)*14:Math.sin(angle2)*14;
          let my = (k<0)? -Math.cos(angle2)*14:Math.cos(angle2)*14;
          newPanel.position.set(x+Math.sin(angle2)*34*k-mx,1,y+Math.cos(angle2)*34*k-my);
          newPanel.rotation.z = Math.PI/3*i+Math.PI/4;
          this.add(newPanel);
        }
      if (j>2) {
        let barMat = new THREE.MeshLambertMaterial({color:'rgb(30,30,30)'});
        let bar = new THREE.Mesh(new THREE.PlaneGeometry(j*17,3), barMat);
        bar.position.set(x,-2.5,y);
        bar.rotation.set(-Math.PI/2,0,Math.PI/3*i+Math.PI/4);
        this.add(bar);
        }
      }
    }
    this.position.set(0, 0, 0);
  }
}

class StationTop extends THREE.Group {
  constructor() {
    super();
    this.url = './models/stationTop.glb'
    this.onCreate();
    let poleGeo = new THREE.CylinderGeometry( 1, 3, 120, 8 );
    let poleMat = new THREE.MeshLambertMaterial({color:0x666666});
    let pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(-25,153,0);
    this.add(pole.clone());
    pole.position.set(25,153,0);
    this.add(pole);
  }
  onCreate() {
    new GLTFLoader().load( this.url, gltf => {
      gltf.scene.scale.set(28, 30, 28);
      this.add(gltf.scene);
    });
  }
}

class Station extends THREE.Group {
  constructor() {
    super();
    this.url = './models/station2.glb'
    this.onCreate();
  }
  onCreate() {
    new GLTFLoader().load( this.url, gltf => {
      this.place(gltf.scene);
      this.add(gltf.scene);
      } 
    );
  }
  place(model) {
    this.scale.set(60, 47, 60);
    this.position.set(0, -800, 0);
    this.rotation.set(0, Math.PI/2, 0);
  }  
  update(t) {
    this.rotateY(-t*0.1);
  }
}

class TaxiLights extends THREE.Group {
  constructor() {
    super();
    this.geometry = new THREE.CylinderGeometry( 0.2, 0.2, 0.5, 6 ); 
    this.material = new THREE.MeshBasicMaterial( {color: 0xff0000} ); 
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.light = new THREE.PointLight( 0x550000, 1000 );
    this.lightgroup = new THREE.Group();
    this.lightgroup.add(this.mesh);
    this.lightgroup.add(this.light);
    this.onCreate();
  }
  onCreate() {
    for(let i=0; i<6; i++) {
      let angle = Math.PI/3*i+Math.PI/4;
      let x = Math.sin(angle)*424;
      let y = Math.cos(angle)*424;
      for(let j=0; j<4; j++) {  
        let newLight = this.lightgroup.clone();
        let angle2 = Math.PI/2*j+Math.PI/3*i;
        newLight.position.set(x+Math.sin(angle2)*24,-2,y+Math.cos(angle2)*24);
        this.add(newLight);
      }
    }
    this.position.set(0, 0, 0);
  }
  update(t) {
    let c = Math.floor((t*0.003)%7);
    let r = (c == 0 || c == 2)? 1:0.1;
    this.mesh.material.color.r=r;
    for(let child of this.children) {
      child.children[1].intensity = r*1000;
    }
  }
}

class Stars extends THREE.Group {
  constructor() {
    super();
    const vertices = [];
    const vertex = new THREE.Vector3();
    for ( let i = 0; i < 2500; i ++ ) {
      vertex.x = Math.random() * 2 - 1;
      vertex.y = Math.random() * 2 - 1;
      vertex.z = Math.random() * 2 - 1;
      vertex.normalize().multiplyScalar( 1200 );
      vertices.push( vertex.x, vertex.y, vertex.z );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute( vertices, 3 ) );
    const material = new THREE.PointsMaterial({ size: 1, color: 0xffffff });
    this.add( new THREE.Points(geometry, material) );
  }
}

class Earth extends THREE.Group {
  constructor() {
    super();
    this.radius = 300;
    this.earthMaterial = new THREE.MeshBasicMaterial( {
      map: textureLoader.load( 'textures/earth.jpg' ),
    } );
    this.earthGeometry = new THREE.PlaneGeometry( 833, 827 );
    this.earth = new THREE.Mesh( this.earthGeometry, this.earthMaterial );
    this.earth.rotation.set(-Math.PI/2, 0, 0);
    this.earth.position.set(10,0,10);
    this.add( this.earth );
    this.position.set(0,-500,0);

   }
}

export { Light, Pad, Ship, Station, TaxiLights, Stars, Earth, StationTop, Panels}














