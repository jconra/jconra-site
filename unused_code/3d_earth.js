class Earth extends THREE.Group {
  constructor(scene) {
    super();
    this.radius = 300;
    scene.add(this);
    this.material = new THREE.MeshPhongMaterial( {
      specular: 0x7c7c7c,
      shininess: 50,
      map: textureLoader.load( './textures/earthmap.jpg' ),
      specularMap: textureLoader.load( './textures/earth_specular_2048.jpg' ),
      normalMap: textureLoader.load( './textures/earth_normal_2048.jpg' ),
      normalScale: new THREE.Vector2( 0.45, - 0.45 ),
    } );
    this.geometry = new THREE.SphereGeometry(this.radius, 100, 50);
    this.earth = new THREE.Mesh( this.geometry, this.material );
    this.earth.rotation.set(-Math.PI*0.27, Math.PI*0.09, 0);
    this.add( this.earth );

    this.cloud_material = new THREE.MeshLambertMaterial( {
      map: textureLoader.load( 'textures/earth_clouds_1024.png' ),
      side: THREE.FrontSide,
      transparent: true,
      opacity: 2.5
    } );
    this.cloud_mesh = new THREE.Mesh( this.geometry, this.cloud_material );
    this.cloud_mesh.scale.set( 1.001, 1.001, 1.001 );
    this.cloud_mesh.rotation.set(-Math.PI*0.27, Math.PI, 0);
    this.add( this.cloud_mesh );

    this.glow_material = new THREE.MeshBasicMaterial( {
      map: textureLoader.load( 'textures/glow.png' ),
      transparent: true
    } );
    this.circle = new THREE.PlaneGeometry( this.radius * 2 * 1.3, this.radius * 2 * 1.3);
    this.glow_mesh = new THREE.Mesh( this.circle, this.glow_material );
    this.glow_mesh.rotation.set(-Math.PI/2, 0, 0);
    this.glow_mesh.position.set(10,0,10);
    this.add( this.glow_mesh );
    this.position.set(0,-500,0);
   }
}
