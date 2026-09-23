const TRACK_MAX = 30;

class Controls {
  constructor(domElement) {
    this.keys = [];
    this.track = 0;
    this.mouse = {
      start: {x:undefined, y:undefined},
      last: {x:undefined, y:undefined},
      down: false,
      x: undefined,
      y: undefined
    }
    this.onCreate(domElement);
  }

  onCreate(domElement) {
    domElement.addEventListener('keydown', (e) => this.onKeyDown(e));
    domElement.addEventListener('keyup', (e) => this.onKeyUp(e));
    domElement.addEventListener('mousewheel', (e) => this.scroll(e));
    domElement.addEventListener('touchstart', (e) => this.touchStart(e));
    domElement.addEventListener('touchmove', (e) => this.touchMove(e));
    domElement.addEventListener('touchend', (e) => this.touchEnd(e));
  }

  touchStart( e ) {
    this.mouse.down = true;
    let t = e.touches[0];
    this.setXY(t.clientX, t.clientY, this.mouse.start);
    this.setXY(t.clientX, t.clientY, this.mouse.last);
    this.setXY(t.clientX, t.clientY, this.mouse);
  }

  touchMove( e ) {
    e.preventDefault();
    let t = e.touches[0];
    this.setXY(this.mouse.x, this.mouse.y, this.mouse.last);
    this.setXY(t.clientX, t.clientY, this.mouse);
    this.track += (this.mouse.y - this.mouse.last.y)/70;
    if (this.track < 0) this.track = 0; 
    if (this.track > TRACK_MAX) this.track = TRACK_MAX;
  }

  touchEnd( e ) {
    this.mouse.down = false;
  }
  
  setXY = (x, y, p) => {p.x = x; p.y = y};

  onKeyDown( e ) {
    if (this.keys.indexOf(e.key) == -1) this.keys.push(e.key);
  }

  onKeyUp( e ) {
    this.keys.splice(this.keys.indexOf(e.key),1);
  } 

  scroll( e ) {
    this.track += e.deltaY/250;
    if (this.track < 0) this.track = 0; 
    if (this.track > TRACK_MAX) this.track = TRACK_MAX;
  }

  update(position) {
    if (this.keys.indexOf('w') >= 0) position.z -= 1;
    if (this.keys.indexOf('a') >= 0) position.x -= 1;
    if (this.keys.indexOf('s') >= 0) position.z += 1;
    if (this.keys.indexOf('d') >= 0) position.x += 1;
  } 
}

export { Controls };
