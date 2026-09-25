// Small synthesized sound set (Web Audio), throttled so fast gems don't turn into noise.

let ctx = null, master = null, muted = false;
const lastPlay = {};

try { muted = localStorage.getItem('hexgem.muted') === '1'; } catch (e) { /* storage blocked */ }

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.35;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}
export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('hexgem.muted', m ? '1' : '0'); } catch (e) { /* storage blocked */ }
  if (master) master.gain.value = m ? 0 : 0.35;
}

function tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, vol = 0.3, attack = 0.005, noise = false, filter = 0, q = 1 }) {
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  let src;
  if (noise) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    src = ctx.createBufferSource();
    src.buffer = buf;
  } else {
    src = ctx.createOscillator();
    src.type = type;
    src.frequency.setValueAtTime(f0, t);
    src.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  }
  let node = src;
  if (filter) {
    const bq = ctx.createBiquadFilter();
    bq.type = 'lowpass'; bq.frequency.value = filter; bq.Q.value = q;
    node.connect(bq); node = bq;
  }
  node.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SOUNDS = {
  ruby: () => { tone({ noise: true, dur: 0.25, vol: 0.18, filter: 900 }); tone({ type: 'sine', f0: 160, f1: 60, dur: 0.2, vol: 0.2 }); },
  topaz: () => tone({ type: 'sawtooth', f0: 1800, f1: 300, dur: 0.12, vol: 0.06, filter: 3000 }),
  aquamarine: () => tone({ type: 'sine', f0: 1200, f1: 700, dur: 0.06, vol: 0.06 }),
  sapphire: () => tone({ type: 'triangle', f0: 900, f1: 1500, dur: 0.18, vol: 0.08 }),
  diamond: () => tone({ type: 'square', f0: 2200, f1: 1600, dur: 0.07, vol: 0.04, filter: 4000 }),
  amethyst: () => tone({ type: 'sine', f0: 600, f1: 1400, dur: 0.2, vol: 0.08 }),
  opal: () => tone({ type: 'triangle', f0: 500, f1: 400, dur: 0.12, vol: 0.06 }),
  emerald: () => tone({ type: 'sine', f0: 300, f1: 200, dur: 0.15, vol: 0.08 }),
  special: () => tone({ type: 'triangle', f0: 700, f1: 350, dur: 0.14, vol: 0.08 }),
  boom: () => { tone({ noise: true, dur: 0.4, vol: 0.2, filter: 600 }); tone({ type: 'sine', f0: 120, f1: 40, dur: 0.35, vol: 0.25 }); },
  nova: () => { tone({ noise: true, dur: 0.5, vol: 0.12, filter: 5000 }); tone({ type: 'sine', f0: 1600, f1: 400, dur: 0.4, vol: 0.1 }); },
  crit: () => tone({ type: 'square', f0: 900, f1: 1800, dur: 0.12, vol: 0.08, filter: 3000 }),
  place: () => { tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.12, vol: 0.18 }); tone({ type: 'sine', f0: 1040, f1: 1040, dur: 0.2, vol: 0.06 }); },
  bad: () => tone({ type: 'square', f0: 180, f1: 120, dur: 0.22, vol: 0.12, filter: 1200 }),
  rock: () => { tone({ noise: true, dur: 0.3, vol: 0.2, filter: 400 }); },
  combine: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => ctx && tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.14 }), i * 70)); },
  special_made: () => { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => ctx && tone({ type: 'triangle', f0: f, dur: 0.45, vol: 0.14 }), i * 80)); },
  coin: () => { tone({ type: 'square', f0: 988, dur: 0.07, vol: 0.05, filter: 5000 }); setTimeout(() => ctx && tone({ type: 'square', f0: 1319, dur: 0.12, vol: 0.05, filter: 5000 }), 60); },
  death: () => tone({ type: 'sawtooth', f0: 300, f1: 60, dur: 0.18, vol: 0.05, filter: 1500 }),
  leak: () => { tone({ type: 'sawtooth', f0: 220, f1: 110, dur: 0.5, vol: 0.15, filter: 800 }); },
  wave: () => { tone({ type: 'sawtooth', f0: 110, f1: 110, dur: 0.9, vol: 0.12, filter: 700, attack: 0.1 }); tone({ type: 'sawtooth', f0: 165, f1: 165, dur: 0.9, vol: 0.08, filter: 700, attack: 0.1 }); },
  upgrade: () => { [659, 880, 1175].forEach((f, i) => setTimeout(() => ctx && tone({ type: 'sine', f0: f, dur: 0.25, vol: 0.12 }), i * 60)); },
};
const GAP = { aquamarine: 0.09, diamond: 0.06, topaz: 0.08, death: 0.05, special: 0.07, ruby: 0.08, crit: 0.1 };

export function sfx(name) {
  if (!ctx || muted || !SOUNDS[name]) return;
  const now = ctx.currentTime;
  if (now - (lastPlay[name] || 0) < (GAP[name] ?? 0.04)) return;
  lastPlay[name] = now;
  try { SOUNDS[name](); } catch (e) { /* ignore */ }
}
