class Message {
  constructor(text, args={}) {
    this.text = text;
    this.font = 'nasa';
    this.x = 100;
    this.y = 100;
    this.w = 9999;
    this.h = 70;
    this.ox = window.innerWidth/2;
    this.oy = -100;
    this.ui = document.getElementById("ui");
    this.ix = ui.getContext('2d',{willReadFrequently: true});
    this.cw = ui.width = window.innerWidth;
    this.ch = ui.height = window.innerHeight;
    this.progress = 0;
    this.speed = 1;
    this.status = "waiting";
    this.onComplete = undefined;
    Object.keys(args).forEach(key => { this[key]=args[key]; });
    this.ix.font = this.h + "px "+ this.font;
    this.ix.strokeStyle = 'rgba(0,220,255,0.05)';
    this.start = function() {this.status = 'running';}
    this.ix.msgRunning = true;
  }
  projection(str, i=0) {
    if (str.length == 0) return;
    //if (Math.random() > 0.5) return;
    let width = Math.floor(this.ix.measureText(str).width);
    let y = this.y-this.h+this.h*i*1.05;
    let mID = this.ix.getImageData(this.x, y, width, this.h);
    for (let j=0; j<mID.data.length; j+=4) {
      if (mID.data[j+2] > 0) {
        this.ix.beginPath();
        this.ix.moveTo(this.ox, this.oy);
        let pix_row = Math.floor((j/4)/width);
        this.ix.lineTo(this.x+(j/4)%width, y+pix_row);
        this.ix.stroke();
      }
      j += Math.floor(Math.random()*10+0.5)*4;
    }
  }
  status_check() {
    if (this.progress > 1) { 
      this.progress = 1;
      this.status = 'complete';
      this.ix.msgRunning = false;
      if (this.onComplete) {
        this.onComplete();
        this.onComplete = undefined;
      }
    } else this.ix.msgRunning = true;
  }
}

class Title extends Message {
  constructor(text, args) {
    super(text, args)
    this.onCreate();
  }
  onCreate() {
    let width = this.w;
    while ((width+this.x+100) > this.cw) {
      this.ix.font = this.h+"px "+this.font;
      width = this.ix.measureText(this.text).width;
      this.h -= 2;
    }
  }
  update(t) {
    if (this.status == "waiting") return;
    this.progress += t/this.speed;
    this.status_check();
    let pInt = Math.floor(this.text.length*this.progress);
    let sStr = this.text.substr(0, pInt);
    this.ix.font = this.h + "px "+ this.font;
    this.ix.fillStyle = 'rgba(0,220,255,0.5)';
    this.ix.fillText(sStr, this.x, this.y);
    this.projection(sStr);
  }
}

class MultiLine extends Message {
  constructor(text, args) {
    super(text, args)
    this.rows = [];
    this.onCreate();
  }
  onCreate() {
    let width = (this.w < this.cw-this.x-50)? this.w:this.cw-this.x-50;
    let track = 0;
    let temp = this.text
    while( temp.length > 0) {
      let ns = temp.substr(track).indexOf(" ");
      if (ns == -1) {this.rows.push(temp); temp=""; continue;}
      if (this.ix.measureText(temp.substr(0,ns+track)).width > width) {
        this.rows.push(temp.substr(0,track));
        temp = temp.substr(track);
        track = 0;
      } 
      else track = ns+track+1;
    }
  }
  update(t) {
    //this.background();
    if (this.status == "waiting") return;
    this.progress += t/this.speed;
    this.status_check();
    let pInt = Math.floor(this.text.length*this.progress);
    this.ix.font = this.h + "px "+ this.font;
    this.ix.fillStyle = 'rgba(0,220,255,0.5)';
    for (let i=0; i<this.rows.length; i++) {
      let sStr = this.rows[i].substr(0, pInt);
      this.ix.fillText(sStr, this.x, this.y + this.h*i*1.05);
      pInt-=sStr.length;
    }
  }
  background() {
    this.ix.beginPath();
    this.ix.moveTo(this.x, this.y);
    this.ix.lineTo(this.x+this.w, this.y);
    this.ix.lineTo(this.x+this.w, this.y+this.h);
    this.ix.lineTo(this.x, this.y+this.h);
    this.ix.fillStyle = "rgba(50,50,50,0.5)";
    this.ix.fill();
  }
}

export { Title, MultiLine }
