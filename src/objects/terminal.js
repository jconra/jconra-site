// TERMINAL. A command-line boot screen: text types out quickly, character by character, with
// progress bars that fill as the scene's files arrive, the way a package manager reports an
// update. It draws to one canvas that is shown full screen while everything loads, and that same
// canvas is the picture on the monitor when the camera pulls back into the room - so the screen
// you were reading is the one on the desk.
//
// The canvas is a portrait column, so on a phone it fills the screen, and on the monitor it sits
// in the left part of the display like a terminal window.
export class Terminal {
  constructor({ width = 720, height = 1120, font = 'Console, ui-monospace, Menlo, Consolas, monospace', colour = '#5eff8a', cps = 700 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width; this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.font = font; this.colour = colour; this.cps = cps;      // characters per second
    this.size = Math.round(width / 30);                          // about 30 columns...
    this.size = 26; this.lineH = 34; this.pad = 28;
    this.cols = Math.floor((width - this.pad * 2) / (this.size * 0.6));
    this.lines = [];           // { text, done } typed lines, or { bar, label, frac } progress bars
    this.queue = [];           // lines still to type, in order
    this.typing = null;        // the line being typed: { text, shown }
    this.carry = 0;            // fractional characters owed by the typing rate
    this.t = 0; this.dirty = true;
    this.onLine = null;        // called when a queued line finishes typing
  }

  // queue text to be typed; long lines wrap to the column width so a phone never clips them
  say(text) {
    for (const raw of String(text).split('\n')) {
      const words = raw.split(' '); let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length > this.cols) { this.queue.push({ text: line }); line = w; }
        else line = (line ? line + ' ' : '') + w;
      }
      this.queue.push({ text: line });
    }
    return this;
  }
  // a progress bar with a label; returns the bar so its fraction can be set as bytes arrive
  bar(label) { const b = { bar: true, label, frac: 0 }; this.queue.push(b); return b; }
  clear() { this.lines = []; this.queue = []; this.typing = null; this.dirty = true; }

  update(dt) {
    this.t += dt;
    // typing: consume characters from the queue at the rate, with a little unevenness
    this.carry += dt * this.cps * (0.7 + 0.6 * Math.abs(Math.sin(this.t * 7)));
    while (this.carry >= 1) {
      if (!this.typing) {
        const next = this.queue.shift();
        if (!next) { this.carry = 0; break; }
        if (next.bar) { this.lines.push(next); this.dirty = true; continue; }
        this.typing = { text: next.text, shown: 0 };
      }
      this.typing.shown++; this.carry--; this.dirty = true;
      if (this.typing.shown >= this.typing.text.length) { this.lines.push({ text: this.typing.text }); this.typing = null; if (this.onLine) this.onLine(); }
    }
    // bars redraw as they fill, and the cursor blinks
    if (this.lines.some(l => l.bar && l.frac < 1) || Math.floor(this.t * 2.5) !== this.blinkPhase) this.dirty = true;
    this.blinkPhase = Math.floor(this.t * 2.5);
    if (this.dirty) this.draw();
  }

  get done() { return !this.queue.length && !this.typing && this.lines.every(l => !l.bar || l.frac >= 1); }

  draw() {
    this.dirty = false;
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height, s = this.size, lh = this.lineH, pad = this.pad;
    g.fillStyle = '#020604'; g.fillRect(0, 0, W, H);
    g.font = `${s}px ${this.font}`; g.textBaseline = 'top';
    const rows = [...this.lines]; if (this.typing) rows.push({ text: this.typing.text.slice(0, this.typing.shown), live: true });
    // keep the tail on screen: scroll up when the text runs past the bottom
    const maxRows = Math.floor((H - pad * 2) / lh);
    const start = Math.max(0, rows.length - maxRows);
    let y = pad;
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      if (r.bar) {
        const label = r.label.padEnd(18, ' ').slice(0, 18);
        const barCols = Math.max(8, this.cols - 18 - 7);
        const filled = Math.round(Math.min(1, r.frac) * barCols);
        const txt = `${label}[${'#'.repeat(filled)}${'-'.repeat(barCols - filled)}] ${Math.round(Math.min(1, r.frac) * 100).toString().padStart(3)}%`;
        g.fillStyle = r.frac >= 1 ? this.colour : 'rgba(94,255,138,0.75)'; g.fillText(txt, pad, y);
      } else {
        g.fillStyle = r.text.startsWith('>') ? '#dfffe6' : this.colour;
        g.fillText(r.text, pad, y);
        if (r.live) { g.fillStyle = this.colour; g.fillRect(pad + g.measureText(r.text).width + 4, y + 2, s * 0.6, s); }
      }
      y += lh;
    }
    // a resting cursor when nothing is typing
    if (!this.typing && this.blinkPhase % 2 === 0) { g.fillStyle = this.colour; g.fillRect(pad, y + 2, s * 0.6, s); }
    // scanlines, faint
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let yy = 0; yy < H; yy += 4) g.fillRect(0, yy, W, 1);
  }
}
