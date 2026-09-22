// TERMINAL. A command-line boot screen: text types out quickly, character by character, with
// progress bars that fill as the scene's files arrive, the way a package manager reports an
// update. It draws to one canvas that is shown full screen while everything loads, and that same
// canvas is the picture on the monitor when the camera pulls back into the room - so the screen
// you were reading is the one on the desk.
//
// The canvas is a portrait column, so on a phone it fills the screen, and on the monitor it sits
// in the left part of the display like a terminal window.
export class Terminal {
  // The canvas takes the shape of the screen it will fill (portrait on a phone, wide on a desktop),
  // so nothing is stretched, at a size that keeps the text crisp.
  constructor({ width, height, font = 'Console, ui-monospace, Menlo, Consolas, monospace', colour = '#5eff8a', cps = 700 } = {}) {
    if (!width) { const portrait = innerHeight > innerWidth; width = portrait ? 720 : 1600; height = Math.round(width * innerHeight / innerWidth); }
    this.canvas = document.createElement('canvas');
    this.canvas.width = width; this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.font = font; this.colour = colour; this.cps = cps;      // characters per second
    this.size = Math.max(22, Math.min(34, Math.round(width / 28)));   // 26 px on the phone column, 34 on a wide screen
    this.lineH = Math.round(this.size * 1.3); this.pad = 28;
    this.cols = Math.floor((width - this.pad * 2) / (this.size * 0.6));
    this.lines = [];           // { text, done } typed lines, or { bar, label, frac } progress bars
    this.queue = [];           // lines still to type, in order
    this.typing = null;        // the line being typed: { text, shown }
    this.carry = 0;            // fractional characters owed by the typing rate
    this.t = 0; this.dirty = true;
    this.onLine = null;
    this.prompt = 'jacob@hab-1:~$ ';
    this.waiting = 0;         // seconds left on a pause        // called when a queued line finishes typing
  }

  // queue text to be typed; long lines wrap to the column width so a phone never clips them.
  // `rate` is characters per second for this text: commands are typed at a human pace, output
  // is printed in a burst, the way a terminal shows it.
  say(text, rate = this.cps) {
    for (const raw of String(text).split('\n')) {
      const words = raw.split(' '); let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length > this.cols) { this.queue.push({ text: line, rate }); line = w; }
        else line = (line ? line + ' ' : '') + w;
      }
      this.queue.push({ text: line, rate });
    }
    return this;
  }
  cmd(text) { return this.say(this.prompt + text, 40).wait(0.08); }   // typed like a person, then Enter; the answer comes at once
  out(text) { return this.say(text, 900); }                          // printed like output
  wait(seconds) { this.queue.push({ wait: seconds }); return this; }
  // hold the script here until every bar so far has filled (the files have arrived)
  gate() { this.queue.push({ gate: true }); return this; }
  // a progress bar with a label; returns the bar so its fraction can be set as bytes arrive. What
  // is drawn eases toward that, so a file that was already here still fills over a moment.
  bar(label) { const b = { bar: true, label, frac: 0, shown: 0 }; this.queue.push(b); return b; }
  clear() { this.lines = []; this.queue = []; this.typing = null; this.dirty = true; }

  update(dt) {
    this.t += dt;
    // bars ease toward what has really arrived
    for (const l of this.lines) if (l.bar && l.shown < l.frac) { l.shown = Math.min(l.frac, l.shown + dt * 1.1); this.dirty = true; }
    // pauses, and the gate that waits for the bars
    if (this.waiting > 0) { this.waiting -= dt; }
    else if (!this.typing && this.queue.length && this.queue[0].gate) { if (this.lines.every(l => !l.bar || l.shown >= 1)) this.queue.shift(); }
    else {
      // typing: consume characters from the queue at the line's rate, with a little unevenness
      const rate = this.typing ? this.typing.rate : (this.queue[0] && this.queue[0].rate) || this.cps;
      this.carry += dt * rate * (0.7 + 0.6 * Math.abs(Math.sin(this.t * 7)));
      while (this.carry >= 1) {
        if (!this.typing) {
          const next = this.queue.shift();
          if (!next) { this.carry = 0; break; }
          if (next.bar) { this.lines.push(next); this.dirty = true; continue; }
          if (next.wait) { this.waiting = next.wait; this.carry = 0; break; }
          if (next.gate) { this.queue.unshift(next); this.carry = 0; break; }
          this.typing = { text: next.text, shown: 0, rate: next.rate || this.cps };
          if (!next.text.length) { this.lines.push({ text: '' }); this.typing = null; continue; }
        }
        this.typing.shown++; this.carry--; this.dirty = true;
        if (this.typing.shown >= this.typing.text.length) { this.lines.push({ text: this.typing.text }); this.typing = null; if (this.onLine) this.onLine(); }
      }
    }
    // the cursor blinks
    if (Math.floor(this.t * 2.5) !== this.blinkPhase) this.dirty = true;
    this.blinkPhase = Math.floor(this.t * 2.5);
    if (this.dirty) this.draw();
  }

  get done() { return !this.queue.length && !this.typing && this.waiting <= 0 && this.lines.every(l => !l.bar || l.shown >= 1); }
  // the row the cursor is on (where the next line will print), in canvas pixels from the top,
  // allowing for the scroll when the text has run past the bottom; and whether a line is up
  cursorY() {
    const rows = this.lines.length + (this.typing ? 1 : 0), maxRows = Math.floor((this.canvas.height - this.pad * 2) / this.lineH);
    return this.pad + (rows - Math.max(0, rows - maxRows)) * this.lineH;
  }
  printed(text) { return this.lines.some(l => l.text === text); }

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
        const filled = Math.round(Math.min(1, r.shown) * barCols);
        const txt = `${label}[${'#'.repeat(filled)}${'-'.repeat(barCols - filled)}] ${Math.round(Math.min(1, r.shown) * 100).toString().padStart(3)}%`;
        g.fillStyle = r.shown >= 1 ? this.colour : 'rgba(94,255,138,0.75)'; g.fillText(txt, pad, y);
      } else {
        g.fillStyle = r.text.startsWith('>') || r.text.startsWith(this.prompt) ? '#dfffe6' : this.colour;
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
