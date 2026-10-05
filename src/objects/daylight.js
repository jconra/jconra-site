// DAYLIGHT: where the sun is at any time of day, and the colours of everything it lights at that height.
//
//   sunDirection(hour, { lat, season, turn }, out)  a unit vector toward the sun (y up), for local solar time
//       `hour` (0..24, 12 = noon). lat: the place's latitude (degrees); season: -1 midwinter .. 1 midsummer (the sun's
//       height at noon follows it); turn: the whole path turned round the up axis (degrees), so the sun can be made
//       to set behind whichever hills look best. North is -z, east +x before the turn.
//   moonDirection(sun, out)                          the moon: across the sky from the sun, a little off the line
//   daylightAt(elev, out)                           the colours and strengths for a sun `elev` degrees up (below
//       0 after sunset), on a smooth curve through the stops below. Gradual all the way: nothing switches at a threshold.
//
// The stops are a dusk painted by eye, not a physical sky: noon is the Terrain Lab's own look as it was tuned (sun
// 0xfff1dc at 2.4, sky light 0xcfe3ff / 0x6b5a44 at 0.9, horizon 0xa9c8e4, overhead 0x4f86c6), and the low sun turns
// the light gold, then orange and red, the horizon toward the sun warm and the one away lavender, then blue hour, then
// night. `toward` is the horizon's colour looking toward the sun, `horizon` looking away (the sky and the fog both
// blend between them by direction, so far land always melts into the sky behind it); likewise the clouds, `cloud` lit
// toward the sun and `cloudAway` away from it (left out: the same as `cloud`).
import * as THREE from 'three';

const DEG = Math.PI / 180;

export function sunDirection(hour, { lat = 45, season = 0.64, turn = 0 } = {}, out = new THREE.Vector3()) {
  const H = (hour - 12) * 15 * DEG, phi = lat * DEG, dec = 23.44 * Math.max(-1, Math.min(1, season)) * DEG;
  const up = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const east = -Math.cos(dec) * Math.sin(H), north = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(H);
  const t = turn * DEG, x = east, z = -north;
  return out.set(x * Math.cos(t) - z * Math.sin(t), up, x * Math.sin(t) + z * Math.cos(t)).normalize();
}
export const elevationOf = (dir) => Math.asin(Math.max(-1, Math.min(1, dir.y))) / DEG;

// the moon: opposite the sun, lifted and swung a little so it doesn't rise exactly as the sun sets
export function moonDirection(sun, out = new THREE.Vector3()) {
  return out.set(-sun.x * 0.92 + 0.25, -sun.y * 0.85 + 0.12, -sun.z * 0.92 + 0.18).normalize();
}


// the stops, by the sun's height in degrees (colours as hex, sRGB). sunI: the sun's strength; hemiI: the sky light's;
// glow: the brightness of the haze round the sun (and the clouds' gold edge near it); stars 0..1; exposure: the camera's,
// a little higher as it gets dark, the way an eye adjusts; moonI: the moon's light
const STOPS = [
  { e: -90, sun: 0xff5a28, sunI: 0, hemiSky: 0x34447a, hemiGround: 0x18181c, hemiI: 0.65, zenith: 0x03060f, horizon: 0x0a0f26, toward: 0x0a0f26, cloud: 0x0a0c18, glow: 0, stars: 1, exposure: 2.4, moonI: 0.5 },
  { e: -18, sun: 0xff5a28, sunI: 0, hemiSky: 0x3c4c80, hemiGround: 0x1a1a1e, hemiI: 0.65, zenith: 0x050a1c, horizon: 0x0c1230, toward: 0x0d1332, cloud: 0x0c0e1c, glow: 0, stars: 1, exposure: 2.4, moonI: 0.5 },
  { e: -10, sun: 0xff5a28, sunI: 0, hemiSky: 0x52649a, hemiGround: 0x222024, hemiI: 0.64, zenith: 0x0e1a3c, horizon: 0x1e2850, toward: 0x2a2442, cloud: 0x1c1c34, cloudAway: 0x18182c, glow: 0.05, stars: 0.7, exposure: 2.25, moonI: 0.34 },
  { e: -6, sun: 0xff5a28, sunI: 0, hemiSky: 0x6a7cb0, hemiGround: 0x2a2826, hemiI: 0.62, zenith: 0x182c5c, horizon: 0x3c4470, toward: 0x6a3c58, cloud: 0x5a3a5c, cloudAway: 0x3a3a56, glow: 0.18, stars: 0.2, exposure: 2.0, moonI: 0.12 },
  { e: -4, sun: 0xff5a28, sunI: 0, hemiSky: 0x6c74a4, hemiGround: 0x2e2a26, hemiI: 0.64, zenith: 0x223a70, horizon: 0x5a5a84, toward: 0xa84c50, cloud: 0xa65a6a, cloudAway: 0x5e5672, glow: 0.38, stars: 0, exposure: 1.85, moonI: 0 },
  { e: -2, sun: 0xff5a28, sunI: 0, hemiSky: 0x8a88b4, hemiGround: 0x3a3430, hemiI: 0.7, zenith: 0x2c4680, horizon: 0x7a7098, toward: 0xdc6446, cloud: 0xe07a5e, cloudAway: 0x8a7892, glow: 0.62, stars: 0, exposure: 1.7, moonI: 0 },
  { e: 0, sun: 0xff7436, sunI: 0.55, hemiSky: 0x9c98c0, hemiGround: 0x44403a, hemiI: 0.76, zenith: 0x34548f, horizon: 0x8f84a8, toward: 0xf6834c, cloud: 0xf29276, cloudAway: 0xb8a0aa, glow: 0.9, stars: 0, exposure: 1.55, moonI: 0 },
  { e: 2, sun: 0xff9450, sunI: 1.15, hemiSky: 0xa4a8cc, hemiGround: 0x4c4a40, hemiI: 0.82, zenith: 0x3a5c9c, horizon: 0x968fb0, toward: 0xffa060, cloud: 0xffa878, cloudAway: 0xd6c4c4, glow: 0.8, stars: 0, exposure: 1.42, moonI: 0 },
  { e: 5, sun: 0xffb070, sunI: 1.6, hemiSky: 0xb0bcdc, hemiGround: 0x5a4c3e, hemiI: 0.86, zenith: 0x3f68a8, horizon: 0x9eacc8, toward: 0xf6b884, cloud: 0xffcfa0, cloudAway: 0xe8dcd6, glow: 0.6, stars: 0, exposure: 1.28, moonI: 0 },
  { e: 10, sun: 0xffd29a, sunI: 2.0, hemiSky: 0xbfd0ec, hemiGround: 0x635240, hemiI: 0.88, zenith: 0x4676b6, horizon: 0xa6bcd8, toward: 0xe8d2b0, cloud: 0xffe6c8, glow: 0.42, stars: 0, exposure: 1.12, moonI: 0 },
  { e: 20, sun: 0xffe8c8, sunI: 2.3, hemiSky: 0xc8dcf8, hemiGround: 0x6a5844, hemiI: 0.9, zenith: 0x4a80c0, horizon: 0xa8c4e0, toward: 0xc6d6e6, cloud: 0xfff6ea, glow: 0.3, stars: 0, exposure: 1.03, moonI: 0 },
  { e: 35, sun: 0xfff1dc, sunI: 2.4, hemiSky: 0xcfe3ff, hemiGround: 0x6b5a44, hemiI: 0.9, zenith: 0x4f86c6, horizon: 0xa9c8e4, toward: 0xb4d0ea, cloud: 0xfffcf7, glow: 0.24, stars: 0, exposure: 1.0, moonI: 0 },
  { e: 90, sun: 0xfff1dc, sunI: 2.4, hemiSky: 0xcfe3ff, hemiGround: 0x6b5a44, hemiI: 0.9, zenith: 0x4f86c6, horizon: 0xa9c8e4, toward: 0xb4d0ea, cloud: 0xfffcf7, glow: 0.24, stars: 0, exposure: 1.0, moonI: 0 },
];
const COLOURS = ['sun', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'toward', 'cloud', 'cloudAway'], NUMBERS = ['sunI', 'hemiI', 'glow', 'stars', 'exposure', 'moonI'];
// every value as a list along the stops (colours per channel, in the working, linear colour space), with the slope at each
// stop for a smooth curve through them all (Fritsch-Carlson: never overshoots between stops, and keeps changing at an even
// pace through a stop, where easing each step on its own stalled at every stop and rushed between: the light pulsed)
const KEYS = STOPS.map((s) => s.e);
const CURVES = [];
for (const k of COLOURS) for (const ch of ['r', 'g', 'b']) CURVES.push({ k, ch, v: STOPS.map((s) => new THREE.Color(s[k] ?? s.cloud)[ch]) });
for (const k of NUMBERS) CURVES.push({ k, v: STOPS.map((s) => s[k]) });
for (const c of CURVES) {
  const n = c.v.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((c.v[i + 1] - c.v[i]) / (KEYS[i + 1] - KEYS[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
  c.m = m;
}

export function newDaylight() { return { ...Object.fromEntries(COLOURS.map((k) => [k, new THREE.Color()])), ...Object.fromEntries(NUMBERS.map((k) => [k, 0])), elev: 0 }; }
export function daylightAt(elev, out = newDaylight()) {
  const e = Math.max(KEYS[0], Math.min(KEYS[KEYS.length - 1], elev));
  let i = 0; while (i < KEYS.length - 2 && e > KEYS[i + 1]) i++;
  const h = KEYS[i + 1] - KEYS[i], t = (e - KEYS[i]) / h, t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  for (const c of CURVES) { const v = Math.max(0, h00 * c.v[i] + h10 * h * c.m[i] + h01 * c.v[i + 1] + h11 * h * c.m[i + 1]);
    if (c.ch) out[c.k][c.ch] = v; else out[c.k] = v; }
  out.elev = elev; return out;
}
