// Canvas-drawn tiles for the layered material. Every canvas is a power of two so the textures repeat
// and mipmap on WebGL 1. Seeded, so a look can be reproduced.
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Speckle: fine light and dark grain so no surface is ever a flat colour up close.
function speckle(g, size, rand, count, alpha) {
  for (let i = 0; i < count; i++) {
    const v = rand();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 1.6})`;
    g.fillRect(rand() * size, rand() * size, 1 + (v > 0.97 ? 1 : 0), 1);
  }
}

// Hull plating. The tile is a 2x2 grid of plate bays with seams on the tile edges and on the
// half-lines, so a tile turned by a quarter or shifted by half still meets its neighbours on a seam.
export function panelTexture(seed = 1, size = 512) {
  const rand = rng(seed), h = size / 2;
  return canvasTexture(size, (g) => {
    g.fillStyle = '#6f7880'; g.fillRect(0, 0, size, size);
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
      const x0 = bx * h, y0 = by * h;
      const splits = rand() < 0.5 ? [[0, 0, 1, 1]]
        : rand() < 0.5 ? [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] : [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]];
      for (const [sx, sy, sw, sh] of splits) {
        const x = x0 + sx * h + 3, y = y0 + sy * h + 3, w = sw * h - 6, hh = sh * h - 6;
        const tone = 104 + rand() * 26;
        g.fillStyle = `rgb(${tone},${tone + 6},${tone + 12})`; g.fillRect(x, y, w, hh);
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, y, w, 2);          // lit top edge
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y + hh - 2, w, 2);        // shadowed lower edge
        g.fillStyle = '#3c434a';                                                   // rivets
        const step = Math.max(18, Math.round(Math.min(w, hh) / 5));
        for (let rx = x + 7; rx < x + w - 4; rx += step) { dot(g, rx, y + 6); dot(g, rx, y + hh - 6); }
        for (let ry = y + 7 + step; ry < y + hh - step; ry += step) { dot(g, x + 6, ry); dot(g, x + w - 6, ry); }
      }
    }
    g.strokeStyle = '#2c3237'; g.lineWidth = 4;                                    // seams
    for (const p of [0, h, size]) { line(g, p, 0, p, size); line(g, 0, p, size, p); }
    if (rand() < 0.8) {                                                            // one hatch of hazard stripe
      const x = rand() < 0.5 ? 12 : h + 12, y = rand() < 0.5 ? h - 34 : size - 34;
      g.save(); g.beginPath(); g.rect(x, y, h - 24, 18); g.clip();
      g.fillStyle = '#20252a'; g.fillRect(x, y, h, 18);
      g.fillStyle = '#c9a23b';
      for (let s = -20; s < h; s += 16) { g.beginPath(); g.moveTo(x + s, y + 18); g.lineTo(x + s + 8, y + 18); g.lineTo(x + s + 26, y); g.lineTo(x + s + 18, y); g.fill(); }
      g.restore();
    }
    speckle(g, size, rand, size * 40, 0.035);
  });
}

// Walkway grating: a square grid of bars over dark voids.
export function gratingTexture(seed = 2, size = 512) {
  const rand = rng(seed), cell = size / 16;
  return canvasTexture(size, (g) => {
    g.fillStyle = '#15191d'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#5d666e';
    for (let i = 0; i < 16; i++) {
      g.fillRect(i * cell, 0, cell * 0.22, size);
      g.fillRect(0, i * cell, size, cell * 0.22);
    }
    g.fillStyle = '#4a5259';
    for (let i = 0; i < 4; i++) { g.fillRect(i * size / 4, 0, 8, size); g.fillRect(0, i * size / 4, size, 8); }
    speckle(g, size, rand, size * 30, 0.04);
  });
}

// THE DIRT PASS from the 2024 site's landing pad: thousands of translucent circles whose opacity
// falls off with their size, so big circles land as faint stains and small ones as sharp specks.
// Drawn on white so the result multiplies over whatever is underneath.
export function dirtTexture(seed = 3, size = 1024, count = 5000) {
  const rand = rng(seed), k = size / 1000;
  return canvasTexture(size, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
    // Drawn over white it multiplies onto light hull plating, which is far harsher than the dark pad it
    // was made for - so the whole pass goes on at partial strength.
    g.globalAlpha = 0.55;
    for (let i = 0; i < count; i++) {
      const n = rand() * 100;
      g.fillStyle = `rgba(${n | 0},${n | 0},${n | 0},${Math.min(1, (0.5 + rand()) / Math.max(n, 1))})`;
      g.beginPath(); g.arc(rand() * size, rand() * size, rand() * (n + 1) * k, 0, Math.PI * 2); g.fill();
    }
  });
}

function dot(g, x, y) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill(); }
function line(g, x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
