// Bake the spike extension into the insect's Strike clip, so it lives in the model rather than in the
// page that plays it.  usage: node bake-spike.cjs <in.glb> <out.glb>
// Same maths as three.js does it at runtime: q_final = q_anim * slerp(identity, Rx*Ry*Rz, k),
// with k = sin(pi * t / clipLength) - nothing at either end, full at the contact frame.
const fs = require('fs');
const [,, IN, OUT] = process.argv;
const SPIKE = { rear:[-3.07,-2.03,-1.27], fore:[2.62,-2.32,0.63] };
const BONES = { rear:['Top-Left-Rear','Top-Right-Rear'], fore:['Top-Left-Forward','Top-Right-Forward'] };

const mul = (a,b) => [ a[0]*b[3]+a[3]*b[0]+a[1]*b[2]-a[2]*b[1], a[1]*b[3]+a[3]*b[1]+a[2]*b[0]-a[0]*b[2],
                       a[2]*b[3]+a[3]*b[2]+a[0]*b[1]-a[1]*b[0], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2] ];
const axisAngle = (i, ang) => { const s=Math.sin(ang/2), q=[0,0,0,Math.cos(ang/2)]; q[i]=s; return q; };
function slerpFromIdentity(q, t) {             // three.js Quaternion.slerp(identity -> q, t)
  let [x,y,z,w] = q;
  if (w < 0) { x=-x; y=-y; z=-z; w=-w; }
  if (w >= 1 - 1e-9) return [0,0,0,1];
  const theta = Math.acos(w), s = Math.sin(theta);
  const a = Math.sin((1-t)*theta)/s, b = Math.sin(t*theta)/s;
  const r = [b*x, b*y, b*z, a + b*w]; const n = Math.hypot(...r); return r.map(v=>v/n);
}
const full = {};
for (const g of ['rear','fore']) { let q=[0,0,0,1]; SPIKE[g].forEach((ang,i)=>{ if (ang) q = mul(q, axisAngle(i, ang)); }); full[g]=q; }

const buf = fs.readFileSync(IN);
const jlen = buf.readUInt32LE(12);
const j = JSON.parse(buf.slice(20, 20+jlen).toString());
let bin = buf.slice(20+jlen+8, 20+jlen+8+buf.readUInt32LE(20+jlen));
const read = ai => { const a=j.accessors[ai], bv=j.bufferViews[a.bufferView], n={SCALAR:1,VEC3:3,VEC4:4}[a.type];
  const off=(bv.byteOffset||0)+(a.byteOffset||0); return new Float32Array(bin.buffer.slice(bin.byteOffset+off, bin.byteOffset+off+a.count*n*4)); };
const extra = [];
let tail = bin.length;
function addAccessor(values, type) {
  const pad = (4 - (tail % 4)) % 4; if (pad) { extra.push(Buffer.alloc(pad)); tail += pad; }
  const data = Buffer.from(new Float32Array(values).buffer);
  j.bufferViews.push({ buffer:0, byteOffset: tail, byteLength: data.length });
  extra.push(data); tail += data.length;
  const n = {SCALAR:1,VEC4:4}[type], mn = new Array(n).fill(Infinity), mx = new Array(n).fill(-Infinity);
  for (let i=0;i<values.length;i++){ const k=i%n; mn[k]=Math.min(mn[k],values[i]); mx[k]=Math.max(mx[k],values[i]); }
  j.accessors.push({ bufferView: j.bufferViews.length-1, componentType:5126, count: values.length/n, type, min:mn, max:mx });
  return j.accessors.length - 1;
}

if (j.extras && j.extras.strikeSpike) {
  console.error('This model already has the spike baked into Strike. Baking again would stack a second');
  console.error('turn on top of the first. Start from a model exported without it.');
  process.exit(1);
}
const anim = j.animations.find(a => a.name === 'Strike');
// the per-frame time base the rear spikes already use
const dense = anim.samplers.map(s=>s.input).reduce((best,i)=> j.accessors[i].count > j.accessors[best].count ? i : best);
const times = read(dense), clipLen = Math.max(...anim.samplers.map(s => j.accessors[s.input].max[0]));
// Blender's first frame lands at 1/24s, not 0, so weight over the keys' real span or the clip would
// start and end with the spikes already part-way out.
const t0 = Math.min(...anim.samplers.map(s => j.accessors[s.input].min[0])), span = clipLen - t0;
console.log('Strike length', clipLen.toFixed(3), 'dense keys', times.length);

for (const g of ['rear','fore']) for (const name of BONES[g]) {
  const node = j.nodes.findIndex(n => n.name === name);
  const ch = anim.channels.find(c => c.target.node === node && c.target.path === 'rotation');
  const s = anim.samplers[ch.sampler];
  const inT = read(s.input), inQ = read(s.output);
  const sample = t => {                               // the clip's own value at time t
    if (s.interpolation === 'STEP' || inT.length === 1) { let k=0; for (let i=0;i<inT.length;i++) if (inT[i] <= t+1e-6) k=i; return Array.from(inQ.slice(k*4,k*4+4)); }
    let i=0; while (i < inT.length-2 && inT[i+1] < t) i++;
    const u = Math.min(1, Math.max(0, (t-inT[i]) / (inT[i+1]-inT[i]))); const a=Array.from(inQ.slice(i*4,i*4+4)), b=Array.from(inQ.slice((i+1)*4,(i+1)*4+4));
    let dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]; if (dot<0) b.forEach((v,k)=>b[k]=-v);
    const r=a.map((v,k)=>v+(b[k]-v)*u), nrm=Math.hypot(...r); return r.map(v=>v/nrm);   // nlerp, fine at 24fps spacing
  };
  const out = [];
  let peak = 0;
  for (const t of times) {
    const k = Math.max(0, Math.sin(Math.PI * (t - t0) / span)); peak = Math.max(peak, k);
    out.push(...mul(sample(t), slerpFromIdentity(full[g], k)));
  }
  const inputAcc = dense, outputAcc = addAccessor(out, 'VEC4');
  anim.samplers.push({ input: inputAcc, output: outputAcc, interpolation: 'LINEAR' });
  ch.sampler = anim.samplers.length - 1;
  console.log(`  ${name.padEnd(18)} was ${inT.length} ${s.interpolation} keys -> ${times.length} LINEAR, peak weight ${peak.toFixed(3)}`);
}
j.extras = Object.assign({}, j.extras, { strikeSpike: { baked:'Strike', rear:SPIKE.rear, fore:SPIKE.fore, weight:'sin(pi*(t-firstKey)/(lastKey-firstKey))' } });

bin = Buffer.concat([bin, ...extra]);
const binPad = (4 - (bin.length % 4)) % 4; if (binPad) bin = Buffer.concat([bin, Buffer.alloc(binPad)]);
j.buffers[0].byteLength = bin.length;
let js = Buffer.from(JSON.stringify(j)); const jsPad = (4 - (js.length % 4)) % 4; if (jsPad) js = Buffer.concat([js, Buffer.alloc(jsPad, 0x20)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546C67,0); header.writeUInt32LE(2,4); header.writeUInt32LE(12+8+js.length+8+bin.length,8);
const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length,0); c1.writeUInt32LE(0x4E4F534A,4);
const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length,0); c2.writeUInt32LE(0x004E4942,4);
fs.writeFileSync(OUT, Buffer.concat([header, c1, js, c2, bin]));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
