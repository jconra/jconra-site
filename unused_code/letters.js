import * as THREE from 'three'; 
import { TextGeometry } from 'textGeometry';
import { FontLoader } from 'fontLoader';


class Text extends THREE.Group {
  constructor(text, pos, size, material, projection) {
    super();
    this.text = text;
    this.pos = pos;
    this.size = size;
    this.material = material;
    this.projection = projection;
    this.onCreate();
  }
  onCreate() {
    //new FontLoader().load( './modules/optimer_regular.typeface.json', font => {
    new FontLoader().load( './modules/fonts/optimer_regular.typeface.json', font => {
      this.geometry = new TextGeometry( this.text, {
        font: font,
        size: this.size,
        height: 5,
        /*
        curveSegments: 5,
        bevelEnabled: true,
        bevelThickness: 4,
        bevelSize: 4,
        bevelOffset: 0,
        bevelSegments: 2
        */
      } );
      const mesh = new THREE.Mesh(this.geometry, this.material);
      if (this.projection) {
        let p = mesh.geometry.attributes.position.array; 
        for (let i=0; i<p.length; i+=3) { if (p[i+2] == 0) {p[i] = 65; p[i+1] = -90; p[i+2] = 0}}
      }
      mesh.position.copy(this.pos);
      this.add(mesh);
    } );    
  }
}

export { Text };
