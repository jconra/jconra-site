/* Look at a frame without a browser.
 *
 * Two fake 2D contexts play back exactly the calls render.js makes:
 *   - offscreen canvases (sky, terrain, scent) only ever fill flat rectangles
 *     or push image data, so those are rasterised into a pixel buffer;
 *   - the visible canvas is recorded as SVG, so the ants stay vector-sharp and
 *     can be enlarged enough to check their anatomy.
 * The offscreen rasters are embedded in the SVG as PNGs, which is how the layer
 * order comes out the same as in the browser.
 *
 *   node tools/snapshot.js [seconds] [seed] [outdir]
 *
 * Writes a whole-tank frame plus close-ups of the queen and a few workers, and
 * rasterises them with ImageMagick if it is on the path.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
var cp = require('child_process');

// ============================================================ png encoding
var CRC = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  var raw = Buffer.alloc((w * 4 + 1) * h);
  var p = 0;
  for (var y = 0; y < h; y++) {
    raw[p++] = 0;                       // filter: none
    for (var x = 0; x < w * 4; x++) raw[p++] = rgba[y * w * 4 + x];
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ============================================================ colour parsing
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  if (s === 0) { var v = Math.round(l * 255); return [v, v, v]; }
  var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  function hue(t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255),
          Math.round(hue(h - 1 / 3) * 255)];
}
function parseColour(str) {
  if (typeof str !== 'string') return [0, 0, 0, 1];
  var s = str.trim(), m;
  if (s[0] === '#') {
    if (s.length === 4) {
      return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16),
              parseInt(s[3] + s[3], 16), 1];
    }
    return [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16),
            parseInt(s.substr(5, 2), 16), 1];
  }
  if ((m = /^rgba?\(([^)]+)\)$/.exec(s))) {
    var p = m[1].split(',').map(Number);
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
  }
  if ((m = /^hsla?\(([^)]+)\)$/.exec(s))) {
    var q = m[1].replace(/%/g, '').split(',').map(Number);
    var rgb = hslToRgb(q[0], q[1], q[2]);
    return [rgb[0], rgb[1], rgb[2], q.length > 3 ? q[3] : 1];
  }
  return [0, 0, 0, 1];
}
function svgColour(str) {
  var c = parseColour(str);
  return { hex: '#' + ((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1),
           a: c[3] };
}

// ========================================================== raster context
/* Enough of a 2D context for the layers render.js keeps offscreen. */
function RasterCtx(canvas) {
  this.canvas = canvas;
  this.px = new Uint8Array(canvas.width * canvas.height * 4);
  this.fillStyle = '#000';
  this.globalAlpha = 1;
  this.imageSmoothingEnabled = true;
}
RasterCtx.prototype.blend = function (x, y, c, a) {
  var w = this.canvas.width;
  if (x < 0 || y < 0 || x >= w || y >= this.canvas.height) return;
  var o = (y * w + x) * 4, p = this.px;
  if (a >= 0.999) { p[o] = c[0]; p[o + 1] = c[1]; p[o + 2] = c[2]; p[o + 3] = 255; return; }
  var da = p[o + 3] / 255, na = a + da * (1 - a);
  if (na <= 0) return;
  p[o] = (c[0] * a + p[o] * da * (1 - a)) / na;
  p[o + 1] = (c[1] * a + p[o + 1] * da * (1 - a)) / na;
  p[o + 2] = (c[2] * a + p[o + 2] * da * (1 - a)) / na;
  p[o + 3] = Math.round(na * 255);
};
RasterCtx.prototype.fillRect = function (x, y, w, h) {
  var x0 = Math.round(x), y0 = Math.round(y);
  var x1 = Math.round(x + w), y1 = Math.round(y + h);
  var grad = this.fillStyle && this.fillStyle.stops;
  for (var yy = y0; yy < y1; yy++) {
    var col, a;
    if (grad) {
      var t = (yy - this.fillStyle.y0) / Math.max(1e-6, this.fillStyle.y1 - this.fillStyle.y0);
      col = gradientAt(this.fillStyle, t); a = 1;
    } else {
      var c = parseColour(this.fillStyle); col = c; a = c[3] * this.globalAlpha;
    }
    for (var xx = x0; xx < x1; xx++) this.blend(xx, yy, col, a);
  }
};
RasterCtx.prototype.clearRect = function (x, y, w, h) {
  var x0 = Math.round(x), y0 = Math.round(y);
  var x1 = Math.round(x + w), y1 = Math.round(y + h);
  for (var yy = y0; yy < y1; yy++) {
    for (var xx = x0; xx < x1; xx++) {
      if (xx < 0 || yy < 0 || xx >= this.canvas.width || yy >= this.canvas.height) continue;
      var o = (yy * this.canvas.width + xx) * 4;
      this.px[o] = this.px[o + 1] = this.px[o + 2] = this.px[o + 3] = 0;
    }
  }
};
function gradientAt(g, t) {
  t = Math.max(0, Math.min(1, t));
  var stops = g.stops;
  for (var i = 1; i < stops.length; i++) {
    if (t <= stops[i].o || i === stops.length - 1) {
      var a = stops[i - 1], b = stops[i];
      var f = (t - a.o) / Math.max(1e-6, b.o - a.o);
      var ca = parseColour(a.c), cb = parseColour(b.c);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f,
              ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  return [0, 0, 0];
}
RasterCtx.prototype.createLinearGradient = function (x0, y0, x1, y1) {
  var g = { x0: x0, y0: y0, x1: x1, y1: y1, stops: [] };
  g.addColorStop = function (o, c) { g.stops.push({ o: o, c: c }); };
  return g;
};
RasterCtx.prototype.createImageData = function (w, h) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
};
RasterCtx.prototype.putImageData = function (img, dx, dy) {
  for (var y = 0; y < img.height; y++) {
    for (var x = 0; x < img.width; x++) {
      var o = (y * img.width + x) * 4;
      var q = ((y + dy) * this.canvas.width + (x + dx)) * 4;
      if (x + dx >= this.canvas.width || y + dy >= this.canvas.height) continue;
      this.px[q] = img.data[o]; this.px[q + 1] = img.data[o + 1];
      this.px[q + 2] = img.data[o + 2]; this.px[q + 3] = img.data[o + 3];
    }
  }
};
RasterCtx.prototype.png = function () {
  return encodePng(this.canvas.width, this.canvas.height, this.px);
};
// the offscreen layers never draw one into another
RasterCtx.prototype.drawImage = function () {};

// ============================================================= svg context
function SvgCtx(canvas) {
  this.canvas = canvas;
  this.els = [];
  this.m = [1, 0, 0, 1, 0, 0];
  this.stack = [];
  this.path = [];
  this.fillStyle = '#000'; this.strokeStyle = '#000';
  this.globalAlpha = 1; this.lineWidth = 1;
  this.lineCap = 'butt'; this.lineJoin = 'miter';
  this.font = '11px monospace'; this.textBaseline = 'alphabetic';
  this.globalCompositeOperation = 'source-over';
  this.imageSmoothingEnabled = true;
}
SvgCtx.prototype.state = function () {
  return { m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
           globalAlpha: this.globalAlpha, lineWidth: this.lineWidth,
           lineCap: this.lineCap, lineJoin: this.lineJoin };
};
SvgCtx.prototype.save = function () { this.stack.push(this.state()); };
SvgCtx.prototype.restore = function () {
  var s = this.stack.pop();
  if (!s) return;
  this.m = s.m; this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle;
  this.globalAlpha = s.globalAlpha; this.lineWidth = s.lineWidth;
  this.lineCap = s.lineCap; this.lineJoin = s.lineJoin;
};
function mul(a, b) {     // apply b then a, canvas order: m = m * b
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
          a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
          a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
SvgCtx.prototype.transform = function (a, b, c, d, e, f) {
  this.m = mul(this.m, [a, b, c, d, e, f]);
};
SvgCtx.prototype.setTransform = function (a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; };
SvgCtx.prototype.translate = function (x, y) { this.transform(1, 0, 0, 1, x, y); };
SvgCtx.prototype.scale = function (x, y) { this.transform(x, 0, 0, y, 0, 0); };
SvgCtx.prototype.rotate = function (r) {
  this.transform(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0);
};
SvgCtx.prototype.pt = function (x, y) {
  var m = this.m;
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
};
function n(v) { return Math.round(v * 100) / 100; }
SvgCtx.prototype.beginPath = function () { this.path = []; };
SvgCtx.prototype.closePath = function () { this.path.push('Z'); };
SvgCtx.prototype.moveTo = function (x, y) {
  var p = this.pt(x, y); this.path.push('M' + n(p[0]) + ' ' + n(p[1]));
};
SvgCtx.prototype.lineTo = function (x, y) {
  var p = this.pt(x, y); this.path.push('L' + n(p[0]) + ' ' + n(p[1]));
};
SvgCtx.prototype.quadraticCurveTo = function (cx, cy, x, y) {
  var c = this.pt(cx, cy), p = this.pt(x, y);
  this.path.push('Q' + n(c[0]) + ' ' + n(c[1]) + ' ' + n(p[0]) + ' ' + n(p[1]));
};
SvgCtx.prototype.bezierCurveTo = function (ax, ay, bx, by, x, y) {
  var a = this.pt(ax, ay), b = this.pt(bx, by), p = this.pt(x, y);
  this.path.push('C' + n(a[0]) + ' ' + n(a[1]) + ' ' + n(b[0]) + ' ' + n(b[1]) +
                 ' ' + n(p[0]) + ' ' + n(p[1]));
};
/* Full ellipses and circles only - that is all render.js draws - approximated
 * with the usual four cubic segments so the CTM can be applied to the control
 * points and the shape comes out correctly skewed. */
var K = 0.5522847498;
SvgCtx.prototype.ellipse = function (cx, cy, rx, ry, rot) {
  var c = Math.cos(rot || 0), s = Math.sin(rot || 0);
  var self = this;
  function P(lx, ly) { return self.pt(cx + lx * c - ly * s, cy + lx * s + ly * c); }
  var p0 = P(rx, 0), p1 = P(0, ry), p2 = P(-rx, 0), p3 = P(0, -ry);
  var h = P(rx, ry * K), i1 = P(rx * K, ry);
  var h2 = P(-rx * K, ry), i2 = P(-rx, ry * K);
  var h3 = P(-rx, -ry * K), i3 = P(-rx * K, -ry);
  var h4 = P(rx * K, -ry), i4 = P(rx, -ry * K);
  this.path.push('M' + n(p0[0]) + ' ' + n(p0[1]));
  this.path.push('C' + n(h[0]) + ' ' + n(h[1]) + ' ' + n(i1[0]) + ' ' + n(i1[1]) + ' ' + n(p1[0]) + ' ' + n(p1[1]));
  this.path.push('C' + n(h2[0]) + ' ' + n(h2[1]) + ' ' + n(i2[0]) + ' ' + n(i2[1]) + ' ' + n(p2[0]) + ' ' + n(p2[1]));
  this.path.push('C' + n(h3[0]) + ' ' + n(h3[1]) + ' ' + n(i3[0]) + ' ' + n(i3[1]) + ' ' + n(p3[0]) + ' ' + n(p3[1]));
  this.path.push('C' + n(h4[0]) + ' ' + n(h4[1]) + ' ' + n(i4[0]) + ' ' + n(i4[1]) + ' ' + n(p0[0]) + ' ' + n(p0[1]));
  this.path.push('Z');
};
SvgCtx.prototype.arc = function (cx, cy, r) { this.ellipse(cx, cy, r, r, 0); };
SvgCtx.prototype.rect = function (x, y, w, h) {
  this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h);
  this.lineTo(x, y + h); this.path.push('Z');
};
SvgCtx.prototype.fill = function () {
  if (!this.path.length) return;
  var c = svgColour(this.fillStyle);
  this.els.push('<path d="' + this.path.join(' ') + '" fill="' + c.hex +
    '" fill-opacity="' + n(c.a * this.globalAlpha) + '"/>');
};
SvgCtx.prototype.stroke = function () {
  if (!this.path.length) return;
  var c = svgColour(this.strokeStyle);
  this.els.push('<path d="' + this.path.join(' ') + '" fill="none" stroke="' + c.hex +
    '" stroke-opacity="' + n(c.a * this.globalAlpha) + '" stroke-width="' + n(this.lineWidth) +
    '" stroke-linecap="' + this.lineCap + '" stroke-linejoin="' + this.lineJoin + '"/>');
};
SvgCtx.prototype.fillRect = function (x, y, w, h) {
  this.beginPath(); this.rect(x, y, w, h); this.fill();
};
SvgCtx.prototype.clearRect = function () {};     // the SVG starts empty
SvgCtx.prototype.clip = function () {};
SvgCtx.prototype.measureText = function (s) { return { width: String(s).length * 6.2 }; };
SvgCtx.prototype.fillText = function (s, x, y) {
  var p = this.pt(x, y);
  var c = svgColour(this.fillStyle);
  this.els.push('<text x="' + n(p[0]) + '" y="' + n(p[1] + 9) + '" font-family="monospace"' +
    ' font-size="11" fill="' + c.hex + '" fill-opacity="' + n(c.a) + '">' +
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>');
};
SvgCtx.prototype.drawImage = function (src, x, y, w, h) {
  var ctx = src._ctx;
  if (!ctx || !ctx.png) return;
  var p = this.pt(x || 0, y || 0);
  var b64 = ctx.png().toString('base64');
  this.els.push('<image x="' + n(p[0]) + '" y="' + n(p[1]) + '" width="' +
    n(w || src.width) + '" height="' + n(h || src.height) +
    '" image-rendering="pixelated" xlink:href="data:image/png;base64,' + b64 + '"/>');
};
SvgCtx.prototype.createLinearGradient = RasterCtx.prototype.createLinearGradient;
SvgCtx.prototype.createImageData = RasterCtx.prototype.createImageData;
SvgCtx.prototype.putImageData = function () {};

// =================================================================== world
function makeCanvas(w, h, kind) {
  var c = { width: w, height: h };
  c.getContext = function () {
    if (!c._ctx) c._ctx = kind === 'svg' ? new SvgCtx(c) : new RasterCtx(c);
    return c._ctx;
  };
  return c;
}
global.document = {
  readyState: 'complete',
  addEventListener: function () {},
  createElement: function () { return makeCanvas(300, 150, 'raster'); }
};

var base = path.join(__dirname, '..', 'js');
['config.js', 'util.js', 'grid.js', 'pheromone.js', 'ant.js', 'colony.js', 'render.js']
  .forEach(function (f) {
    vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
  });

var secs = parseFloat(process.argv[2] || '1200');
var seed = parseInt(process.argv[3] || '4242', 10);
var outdir = process.argv[4] || '/tmp/antfarm';
if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });

var rng = new global.Rng(seed);
var grid = new global.Grid(200, 150, rng);
var colony = new global.Colony(grid, rng);
var canvas = makeCanvas(grid.cols * grid.cell, grid.rows * grid.cell, 'svg');
var renderer = new global.Renderer(canvas, grid, colony);
renderer.scale = 1;
renderer.showHud = false;

var dt = 1 / 60;
// food is user-supplied now, so feed the colony on a timer or it never grows
var feedTimer = 20;
for (var s = 0; s < secs * 60; s++) {
  colony.update(dt);
  feedTimer -= dt;
  if (feedTimer <= 0) {
    feedTimer = 7;
    colony.dropFood(colony.entrance.x * grid.cell + rng.range(-40, 40),
                    (grid.surfaceRow - 3) * grid.cell);
  }
}

/* Repaint the terrain from scratch: the incremental version overpaints, and an
 * SVG has no eraser, so stale rectangles would show through. */
renderer.terrain.getContext('2d').px.fill(0);
renderer.repaintTerrain();

var ctx = canvas.getContext('2d');
ctx.els.length = 0;
renderer.draw();

function writeSvg(name, vx, vy, vw, vh, zoom) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" ' +
    'xmlns:xlink="http://www.w3.org/1999/xlink" width="' + Math.round(vw * zoom) +
    '" height="' + Math.round(vh * zoom) + '" viewBox="' + vx + ' ' + vy + ' ' + vw +
    ' ' + vh + '">\n<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' +
    vh + '" fill="#06090c"/>\n' + ctx.els.join('\n') + '\n</svg>\n';
  var f = path.join(outdir, name + '.svg');
  fs.writeFileSync(f, svg);
  var png = path.join(outdir, name + '.png');
  try {
    cp.execFileSync('convert', ['-background', 'none', f, png], { stdio: 'ignore' });
    console.log('  ' + png);
  } catch (e) {
    console.log('  ' + f + ' (convert failed: ' + e.message.split('\n')[0] + ')');
  }
}

console.log('t=' + colony.age.toFixed(0) + 's ants=' + colony.ants.length +
            ' brood=' + colony.brood.length + ' rooms=' + colony.rooms.length +
            ' svg elements=' + ctx.els.length);
writeSvg('scene', 0, 0, canvas.width, canvas.height, 1);

/* Close-ups: the queen, and the largest workers doing different things. */
var picks = [];
if (colony.queen && colony.queen.alive) picks.push(['queen', colony.queen]);
var byLen = colony.ants.slice().sort(function (a, b) { return b.len - a.len; });
byLen.forEach(function (a) {
  if (a === colony.queen || picks.length >= 5) return;
  var tag = (a.task ? a.task.kind.toLowerCase() : 'idle') + '-' + a.id;
  picks.push([tag, a]);
});
picks.forEach(function (p) {
  var a = p[1], r = Math.max(26, a.len * 1.5);
  writeSvg('ant-' + p[0], Math.round(a.x - r), Math.round(a.y - r), r * 2, r * 2, 10);
});

/* Each nursery, framed on the chamber itself.  Nurseries are dug to a ladder of
 * sizes - a founding cell, then bigger and deeper ones - and the thing to check
 * is headroom: the queen is 37 px long with a deep gaster, so a chamber she has
 * to lie in wants to look like a room she fits in and not a wide bit of tunnel.
 */
colony.rooms.forEach(function (r, i) {
  if (r.type !== 'nursery') return;
  var pad = 6 * grid.cell;
  var x0 = Math.round((r.cx - r.rx) * grid.cell - pad);
  var y0 = Math.round((r.cy - r.ry) * grid.cell - pad);
  var w = Math.round((r.rx * 2) * grid.cell + pad * 2);
  var h = Math.round((r.ry * 2) * grid.cell + pad * 2);
  writeSvg('nursery-' + i + '-holds' + colony.nurseryHolds(r), x0, y0, w, h, 4);
});
