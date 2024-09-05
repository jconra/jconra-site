import * as THREE from 'three';

class Panel {
  constructor(text) {
    this.geo = new THREE.PlaneGeometry(50,25);
    this.can = document.createElement('canvas');
    this.ctx = this.can.getContext('2d');
    this.ch = this.can.height = 400;
    this.cw = this.can.width = 800;
    this.tex = new THREE.CanvasTexture(this.can);
    this.mat = new THREE.MeshBasicMaterial({map:this.tex, transparent:true});
    this.mesh = new THREE.Mesh(this.geo, this.mat);
  }
}

class Displays extends THREE.Group {
  constructor() {
    super();
    this.onCreate();
  }
  onCreate() {
    this.light = new THREE.PointLight( 0x00ff55, 100);
    this.light.position.set(0,200,0);
    this.add(this.light);
    this.welcome = new Panel();
    this.welcome.mesh.position.set(0, 200, 0);
    this.add(this.welcome.mesh);
    drawWelcome(this.welcome);
  }
  update(t) {
    drawWelcome(this.welcome, t); 
  }
}

function drawWelcome(panel, t=0) {
  panel.ctx.clearRect(0,0,panel.cw,panel.ch);
  panel.ctx.font = "100px nasa"
  panel.ctx.fillStyle = "rgba(20,255,150,0.1)";
  panel.ctx.fillRect(0, 0, panel.cw, panel.ch);
  panel.ctx.beginPath();
  panel.ctx.fillStyle = "rgba(20,255,150,0.5)";
  panel.ctx.StrokeStyle = "rgba(100,255,200,0.5)";
  panel.ctx.lineWidth = 5;
  drawText(panel.ctx, "Welcome To", {y:150-t*100, align:"center"});
  drawText(panel.ctx,"Jconra.com", {y:240-t*100, align:"center"});
  panel.ctx.font = "50px nasa";
  let text = "Hello! I am Jacob Conrads, a Systems Engineer. This is a project to play around with and highlight my skills. Thank you for visiting!"
  drawText(panel.ctx, text, {y:350-t*100});
  panel.mat.map.needsUpdate = true;
}

function drawText(ctx, text, args) {
  let s = {
    align: "left",
    size: 100,
    font: 'nasa',
    width: 700,
    x:50, y:0, t:0
  }
  for(let k of Object.keys(args)){s[k] = args[k];}
  if (s.align == "center") {
    do {
      ctx.font = s.size+"px "+s.font;
      s.size -=2;
    } while (ctx.measureText(text).width > s.width);

    s.x = (800 - ctx.measureText(text).width)/2;
  ctx.strokeText(text, s.x, s.y);
  ctx.fillText(text, s.x, s.y);
  } 
else {
    let rows = [];
    let temp = text;
    let track = 0;
    while( temp.length > 0) {
      let ns = temp.substr(track).indexOf(" ");
      if (ns == -1) {rows.push(temp); temp=""; continue;}
      if (ctx.measureText(temp.substr(0,ns+track)).width > s.width) {
        rows.push(temp.substr(0,track));
        temp = temp.substr(track);
        track = 0;
      }
      else track = ns+track+1;
    }
    for(let i=0; i<rows.length; i++) {
      ctx.strokeText(rows[i], s.x, s.y+i*s.size*0.6);
      ctx.fillText(rows[i], s.x, s.y+i*s.size*0.6);
    }
  }
}

export { Displays }
