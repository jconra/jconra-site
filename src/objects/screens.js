// LIVE SCREENS. A canvas laid over a monitor's face, redrawn a few times a second so the room's
// displays are actually doing something: a telemetry console, an orbit plot, and the site's own
// front page, which is the one you can tap to open it. Each screen is given in world metres
// (centre, the way it faces, width, height) measured off the monitor mesh itself.
import * as THREE from 'three';

const FONT = '"nasa", ui-monospace, monospace';
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export class Screen extends THREE.Mesh {
  constructor({ centre, normal, width, height, kind = 'telemetry', href = null, colour = '#7fd0ff' }) {
    const canvas = document.createElement('canvas');
    canvas.width = kind === 'terminal' ? 1536 : 512; canvas.height = Math.round(canvas.width * height / width);   // the terminal is read up close: it gets the pixels
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    super(new THREE.PlaneGeometry(width * 0.9, height * 0.86),
          new THREE.MeshBasicMaterial({ map, toneMapped: false }));
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.map = map;
    this.kind = kind; this.href = href; this.colour = colour; this.source = null;
    this.t = 0; this.next = 0; this.rand = rnd(kind.length * 977 + 13);
    this.log = [];
    const c = new THREE.Vector3(...centre), n = new THREE.Vector3(...normal).normalize();
    this.position.copy(c).addScaledVector(n, 0.008);      // just proud of the glass
    this.lookAt(c.clone().add(n));
  }

  update(dt) {
    this.t += dt;
    if (this.t < this.next) return;
    this.next = this.t + (this.kind === 'terminal' ? 0.04 : 0.12);   // the terminal types fast; the rest need eight a second
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height, t = this.t;
    if (this.kind === 'terminal' && this.source) {
      // the terminal fills the display, black behind it: as large as it goes without stretching
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const src = this.source, k = Math.min(W / src.width, H / src.height), sw = src.width * k, sh = src.height * k;
      g.drawImage(src, (W - sw) / 2, (H - sh) / 2, sw, sh);
    } else {
      g.fillStyle = '#04080f'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(127,208,255,0.10)'; g.lineWidth = 1;
      for (let y = 0; y < H; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      this['draw_' + this.kind](g, W, H, t);
    }
    // a slow sweep of brightness down the panel, as a screen looks when it is filmed
    const grad = g.createLinearGradient(0, ((t * 40) % (H + 120)) - 120, 0, ((t * 40) % (H + 120)));
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.05)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    this.map.needsUpdate = true;
  }

  // scrolling systems log, a few readouts and a trace that keeps drawing
  draw_telemetry(g, W, H, t) {
    const c = this.colour;
    g.font = `bold 22px ${FONT}`; g.fillStyle = c; g.fillText('STATION SYSTEMS', 18, 34);
    g.font = `16px ${FONT}`; g.fillStyle = 'rgba(127,208,255,0.7)';
    const rows = [['ring 1 spin', (2.11 + Math.sin(t * 0.3) * 0.02).toFixed(3) + ' rpm'], ['deck gravity', (0.98 + Math.sin(t * 0.7) * 0.01).toFixed(2) + ' g'],
                  ['cabin pressure', (101.2 + Math.sin(t * 0.2) * 0.3).toFixed(1) + ' kPa'], ['O2 reserve', (86 - (t * 0.01) % 5).toFixed(1) + ' %'],
                  ['orbit', '420 km · ' + Math.floor((t * 4) % 92).toString().padStart(2, '0') + ':' + Math.floor((t * 60) % 60).toString().padStart(2, '0')]];
    rows.forEach(([k, v], i) => { g.fillStyle = 'rgba(127,208,255,0.55)'; g.fillText(k, 18, 70 + i * 26); g.fillStyle = c; g.fillText(v, 230, 70 + i * 26); });
    if (this.rand() < 0.08) this.log.unshift(['reactor trim', 'antenna slew 3°', 'hatch 2 sealed', 'coolant loop nominal', 'ping: ground 41 ms', 'solar wing tracking'][Math.floor(this.rand() * 6)]);
    this.log.length = Math.min(this.log.length, 5);
    g.font = `14px ${FONT}`; g.fillStyle = 'rgba(127,208,255,0.5)';
    this.log.forEach((l, i) => g.fillText('› ' + l, 18, H - 16 - i * 20));
    g.strokeStyle = c; g.lineWidth = 2; g.beginPath();
    for (let x = 0; x < W - 36; x += 4) { const y = H - 150 + Math.sin((x + t * 90) * 0.05) * 14 + Math.sin((x - t * 30) * 0.013) * 10; x ? g.lineTo(18 + x, y) : g.moveTo(18 + x, y); }
    g.stroke();
  }

  // the station's orbit drawn round a little Earth, with the station going round it
  draw_orbit(g, W, H, t) {
    const c = this.colour, cx = W / 2, cy = H / 2 + 10, R = Math.min(W, H) * 0.34;
    g.font = `bold 18px ${FONT}`; g.fillStyle = c; g.fillText('ORBIT', 16, 28);
    g.fillStyle = 'rgba(80,140,255,0.5)'; g.beginPath(); g.arc(cx, cy, R * 0.55, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(127,208,255,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(cx, cy, R, R * 0.42, -0.3, 0, Math.PI * 2); g.stroke();
    const a = t * 0.9; const px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R * 0.42;
    const rx = px * Math.cos(-0.3) - (py - cy) * Math.sin(-0.3) - cx * Math.cos(-0.3) + cx, ry = (px - cx) * Math.sin(-0.3) + (py - cy) * Math.cos(-0.3) + cy;
    g.fillStyle = c; g.beginPath(); g.arc(rx, ry, 5, 0, Math.PI * 2); g.fill();
    g.font = `14px ${FONT}`; g.fillStyle = 'rgba(127,208,255,0.6)'; g.fillText('pass ' + (1 + Math.floor(t / 7)), 16, H - 16);
  }

  // the site's front page, as a screen inside the room: the way in to the rest of the site
  draw_site(g, W, H, t) {
    const c = this.colour;
    g.fillStyle = 'rgba(127,208,255,0.08)'; g.fillRect(0, 0, W, 44);
    g.font = `bold 26px ${FONT}`; g.fillStyle = '#e8f4ff'; g.fillText('JCONRA.COM', 18, 31);
    g.font = `15px ${FONT}`; g.fillStyle = 'rgba(127,208,255,0.6)';
    ['projects', 'labs', 'about'].forEach((s, i) => g.fillText(s, W - 210 + i * 70, 30));
    g.font = `18px ${FONT}`; g.fillStyle = c;
    const lines = ['Systems engineer.', 'This station is the site:', 'the labs are the rooms.'];
    lines.forEach((l, i) => g.fillText(l, 18, 86 + i * 30));
    g.fillStyle = 'rgba(127,208,255,0.5)'; g.font = `15px ${FONT}`;
    g.fillText('tap the screen to open the site', 18, H - 42);
    // the cursor blinks
    if (Math.floor(t * 2) % 2 === 0) { g.fillStyle = c; g.fillRect(18, H - 30, 12, 3); }
    g.strokeStyle = 'rgba(127,208,255,0.35)'; g.lineWidth = 2; g.strokeRect(6, 6, W - 12, H - 12);
  }
}
