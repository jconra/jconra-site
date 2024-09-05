import { draw_rect, draw_border, draw_circle, grid } from 'draw';

class Texture {

  constructor (type) {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext('2d');
    
    if (type == "pad") {
      let cw = this.canvas.width = 1000;
      let ch = this.canvas.height = 1000;

      draw_rect(this.ctx, cw/2, ch/2, cw, ch, 'rgb(30,30,30)');
      this.ctx.translate(cw/2,ch/2);
      this.ctx.rotate(Math.PI/4);
      for (let i=4; i<10; i++) {
        draw_border(this.ctx, 0, 0, 100*i, 100*i, 25, 'rgb(150,150,0)');
      }
      this.ctx.rotate(-Math.PI/4);
      this.ctx.translate(-cw/2,-ch/2);
      draw_border(this.ctx, cw/2, ch/2, 950, 950, 50, 'rgb(30,30,30)');
      draw_border(this.ctx, cw/2, ch/2, 850, 850, 50, 'rgb(150,150,0)');
      draw_border(this.ctx, cw/2, ch/2, 750, 750, 50, 'rgb(30,30,30)');
      draw_rect(this.ctx, cw/2, ch/2, 100, 800, 'rgb(30,30,30)');
      draw_rect(this.ctx, cw/2, ch/2, 800, 100, 'rgb(30,30,30)');
      draw_rect(this.ctx, cw/2, ch/2, 400, 400, 'rgb(30,30,30)');
      draw_border(this.ctx, cw/2, ch/2, 300, 300, 25, 'rgb(150,150,0)');
      this.dirty(5000,cw,ch);
    }
    if (type == "station") {
      let cw = this.canvas.width = 1000;
      let ch = this.canvas.height = 1000;
     
      draw_rect(this.ctx, cw/2, ch/2, cw, ch, 'rgb(70,70,70)');
      for(let i=0; i<10; i++) {
        for(let j=0; j<10; j++) {
          draw_border(this.ctx, i*100+50, j*100+50, 90, 90, 1, 'rgb(50,50,50)');
        }
      } 
      this.dirty(5000,cw,ch);
    }
    if (type == "station_sign") {
      let cw = this.canvas.width = 2500;
      let ch = this.canvas.height = 100;
      draw_rect(this.ctx, cw/2, ch/2, cw, ch, 'rgb(0,0,0)');
      this.ctx.fillStyle = 'rgb(200,50,200)';
      this.ctx.font = "70px serif";
      this.ctx.fillText("Welcome to jconra.com", 1500, 70);
    }
    if (type == "panel") {
      let cw = this.canvas.width = 512;
      let ch = this.canvas.height = 512;
      draw_rect(this.ctx, cw/2, ch/2, cw, ch, 'rgb(5,5,30');
      for(let i=0; i<3; i++) {
        for(let j=0; j<2; j++) {
          grid(this.ctx, cw/2*j+cw/4, ch/3*i+ch/6, 16, 8, 230, 150, 2, 3, "black");
        }
      }
      grid(this.ctx, cw/2, ch/2, 3, 2, 505, 505, 0, 5, 'rgb(30,30,0)');
    }
    if (type == 'walkway') {
      let cw = this.canvas.width = 512;
      let ch = this.canvas.height = 512;
      draw_rect(this.ctx, cw/2, ch/2, cw, ch, 'rgb(10,10,10');
      for(let i=0; i<3; i++) {
        for(let j=0; j<2; j++) {
          grid(this.ctx, cw/2*j+cw/4, ch/3*i+ch/6, 3, 2, 230, 150, 10, 3, "rgb(30,30,30)");
        }
      }
    }
  }
  dirty(t,cw,ch) {
    for (var i=0; i<t; i++) {
      let n = Math.random()*100;
      let c = "rgba("+n+","+n+","+n+","+((0.5+Math.random())/n)+")";
      draw_circle(this.ctx, Math.random()*cw, Math.random()*ch, Math.random()*(n+1), c);
    }
  }
}

export { Texture };
