// THE MAP'S CARDS: as a state lights on the map, pictures from Jacob's years there (certificates, plaques, farewell gifts)
// are thrown up from its pin like cards: each starts as a speck on the pin and flies up, spinning and growing, to a spot of
// its own near the top of the screen (not in a row: a little scattered, each at a tilt), stays while the state is lit and
// fades as the next one lights. Where they are is worked out from the film's time alone, so a pause holds them still for a
// closer look and a scrub back takes them back down. A click (a tap) shows one large in the middle of the screen with what
// it is under it; the film holds while it's open.
//
//   mapCards({ cards, timing, hold, release }) -> { el, update(show, T, pinAt), isOpen(), close() }
//     cards: [{ state, title, text, img, thumb, dark }] in the order they're thrown (dark: a cut-out on a dark card)
//     timing(state): { from, until }: when the state lights, and when the next one does
//     hold(): hold the film (a card opened); release(): let it go (closed)
//     update(show, T, pinAt) each frame: show false off the map (all hidden; an open card closed); pinAt(state): the state's
//       pin on the screen, { x, y } in CSS pixels, or null
const CSS = `
#mapCards { position:fixed; inset:0; z-index:5; pointer-events:none; overflow:hidden; }
#mapCards .mcCard { position:absolute; left:0; top:0; padding:0; border:0; cursor:pointer; pointer-events:auto; display:none; transform-origin:50% 50%; touch-action:none;
  background:#f3efe4; border-radius:3px; box-shadow:0 6px 22px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.6); will-change:transform, opacity; }
#mapCards .mcCard.dark { background:#13212e; }
#mapCards .mcCard img { display:block; position:absolute; left:var(--mcb); top:var(--mcb); width:calc(100% - 2 * var(--mcb)); height:calc(100% - 2 * var(--mcb)); object-fit:contain; pointer-events:none; -webkit-user-drag:none; }
#mapCards .mcCard:focus-visible { outline:2px solid #35e07d; outline-offset:3px; }
#mapCardView { position:fixed; inset:0; z-index:9; display:none; align-items:center; justify-content:center; background:rgba(2,5,8,.62); padding:16px; box-sizing:border-box; }
#mapCardView.on { display:flex; }
#mapCardView figure { margin:0; position:relative; max-width:min(1100px, 100%); max-height:100%; display:flex; flex-direction:column; padding:14px 14px 16px; box-sizing:border-box;
  background:rgba(4,8,12,.94); border:1px solid rgba(53,224,125,.55); border-radius:8px; }
#mapCardView img { display:block; max-width:100%; max-height:calc(100vh - 210px); width:auto; height:auto; margin:0 auto; border-radius:3px; object-fit:contain; }
#mapCardView figcaption { max-width:68ch; margin:12px auto 0; text-align:center; }
#mapCardView b { display:block; font:400 18px nasa, ui-sans-serif, sans-serif; letter-spacing:.06em; color:#35e07d; margin-bottom:6px; }
#mapCardView span { font:15px/1.5 ui-sans-serif, system-ui, sans-serif; color:#e8f1f5; }
#mapCardView button { position:absolute; top:-12px; right:-12px; width:34px; height:34px; border-radius:50%; border:1px solid rgba(53,224,125,.7); background:#04080c; color:#35e07d;
  font:600 18px/1 ui-sans-serif, system-ui, sans-serif; cursor:pointer; }
@media (max-width: 640px) { #mapCardView img { max-height:calc(100vh - 260px); } #mapCardView button { top:-10px; right:-6px; } }
@media (max-height: 500px) and (orientation: landscape) { #mapCardView figure { flex-direction:row; align-items:center; gap:14px; } #mapCardView img { max-height:calc(100vh - 62px); max-width:58vw; }
  #mapCardView figcaption { margin:0; text-align:left; } }   /* (a phone on its side: the words beside the picture, the picture the screen's height) */
`;
// the throw: how long after the state lights the first card goes, the gap between cards (at most), the flight, how long
// after the next state lights they start to fade, and the fade; the cards' size (a share of the screen's area), a little
// smaller on a phone held upright
const THROW = { delay: 0.2, gap: 0.3, fly: 0.75, stay: 0.3, fade: 0.5, area: 0.085, areaTall: 0.06, border: 5 };
// the large look's room for the picture: the box it's drawn in worked out at once (the same for the small picture and the full
// one after it, so nothing jumps), never past the CSS's limits
function viewBox(aspect) {
  const W = innerWidth, H = innerHeight, side = H <= 500 && W > H;
  const maxW = side ? W * 0.58 : Math.min(1100, W - 32) - 28, maxH = side ? H - 62 : H - (W <= 640 ? 260 : 210), w = Math.max(40, Math.min(maxW, maxH * aspect));
  return [w, w / aspect];
}
const easeOut = (u) => 1 - Math.pow(1 - u, 3);
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };   // (0..1, the same every time for a card)

export function mapCards({ cards, timing, hold, release }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const el = document.createElement('div'); el.id = 'mapCards'; document.body.appendChild(el);
  const view = document.createElement('div'); view.id = 'mapCardView'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-modal', 'true');
  view.innerHTML = '<figure><button type="button" aria-label="Close">×</button><img alt=""><figcaption><b></b><span></span></figcaption></figure>';
  document.body.appendChild(view);
  const vImg = view.querySelector('img'), vTitle = view.querySelector('b'), vText = view.querySelector('span');
  // each state's cards: where each goes (spread along the top in its own slot, a little up or down, a tilt), how it spins
  const byState = new Map(); for (const c of cards) { if (!byState.has(c.state)) byState.set(c.state, []); byState.get(c.state).push(c); }
  const items = cards.map((c, i) => {
    const group = byState.get(c.state), j = group.indexOf(c), n = group.length;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mcCard' + (c.dark ? ' dark' : ''); b.setAttribute('aria-label', `${c.title}: see it large`);
    b.style.setProperty('--mcb', `${THROW.border}px`);
    const im = document.createElement('img'); im.alt = ''; im.decoding = 'async'; b.appendChild(im); el.appendChild(b);
    b.addEventListener('click', () => open(i));
    const side = j % 2 ? 1 : -1;
    return { c, b, im, j, n, aspect: 1, ready: false, shown: false, last: '',
      slot: { x: (j + 0.5) / n + (hash(i + 1) - 0.5) * 0.5 / n, y: (j % 2) * 0.55 + hash(i + 7) * 0.45, tilt: side * (4 + hash(i + 3) * 7), spin: -side * (160 + hash(i + 5) * 140) } };
  });
  for (const ev of ['pointerdown', 'touchstart', 'mousedown']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });   // (a card's press is the card's, not the map's poke; its lift goes on, for whoever's waiting on it)
  // the large look: the small picture at once, the full one in its place when it's in
  let openAt = -1;
  function open(i) {
    const { c } = items[i]; openAt = i;
    vImg.src = c.thumb; vImg.alt = c.title; vTitle.textContent = c.title; vText.textContent = c.text || ''; fit();
    if (c.img && c.img !== c.thumb) { const full = new Image(); full.onload = () => { if (openAt === i) vImg.src = c.img; }; full.src = c.img; }
    view.classList.add('on'); hold(); view.querySelector('button').focus({ preventScroll: true });
  }
  function close() { if (openAt < 0) return; const i = openAt; openAt = -1; view.classList.remove('on'); release(); if (items[i].shown) items[i].b.focus({ preventScroll: true }); }
  function fit() { if (openAt < 0) return; const [w, h] = viewBox(items[openAt].aspect); vImg.style.width = `${w.toFixed(0)}px`; vImg.style.height = `${h.toFixed(0)}px`; }
  addEventListener('resize', fit);
  view.addEventListener('click', (e) => { if (e.target === view || e.target.closest('button')) close(); });
  for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'wheel']) view.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });   // (looking: the film stays put)
  addEventListener('keydown', (e) => {
    if (openAt < 0) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); view.querySelector('button').focus({ preventScroll: true }); }   // (the keys stay in the large look: nothing behind it, the film bar's play included)
  }, true);
  let loading = false;
  return {
    el,
    isOpen: () => openAt >= 0,
    close,
    update(show, T, pinAt) {
      if (!loading && (show || T > 12)) { loading = true; for (const it of items) { it.im.onload = () => { it.aspect = it.im.naturalWidth / it.im.naturalHeight || 1; it.ready = true; it.last = ''; }; it.im.src = it.c.thumb; } }   // (the small pictures fetched well before the map)
      if (!show && openAt >= 0) close();
      const W = innerWidth, H = innerHeight, tall = W < H, area = (tall ? THROW.areaTall : THROW.area) * W * H;
      for (const it of items) {
        const tm = show ? timing(it.c.state) : null;
        const t0 = tm ? tm.from + THROW.delay + it.j * Math.min(THROW.gap, 1.2 / it.n) : 0, leave = tm ? clamp01((T - tm.until - THROW.stay) / THROW.fade) : 1;
        if (!tm || !it.ready || T < t0 || leave >= 1) { if (it.shown) { it.shown = false; it.b.style.display = 'none'; } continue; }
        // its size for this screen, its spot (the band across the top, clear of the film bar on the right)
        let w = Math.sqrt(area * it.aspect), h = w / it.aspect; const k = Math.min(1, (tall ? 0.46 : 0.28) * W / w, (it.aspect < 0.6 ? 0.4 : 0.3) * H / h);   // (a tall narrow one may stand a little taller) w *= k; h *= k;
        const right = W <= 640 ? 30 : 60, x = Math.min(Math.max(W * (0.06 + 0.84 * it.slot.x), w / 2 + 8), W - right - w / 2), y = H * (tall ? 0.08 : 0.12) + h * 0.5 + it.slot.y * H * (tall ? 0.2 : 0.14);   // (wholly on the screen, clear of the film bar)
        // the flight: from the pin, up past its spot and settling (an arc), spinning out to its tilt, from a speck to full size
        const u = clamp01((T - t0) / THROW.fly), e = easeOut(u), p = pinAt(it.c.state) || { x: W / 2, y: H * 0.7 };
        const px = p.x + (x - p.x) * e, py = p.y + (y - p.y) * e - Math.sin(Math.PI * u) * H * 0.07 - leave * H * 0.04;
        const s = (1 / Math.max(w, h)) + (1 - 1 / Math.max(w, h)) * e, s2 = s * (1 - 0.12 * leave), rot = it.slot.tilt + (1 - e) * it.slot.spin;
        const tf = `translate(${(px - w / 2).toFixed(1)}px,${(py - h / 2).toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${s2.toFixed(4)})`, op = (1 - leave).toFixed(3);
        if (!it.shown) { it.shown = true; it.b.style.display = 'block'; }
        const key = `${w.toFixed(1)}|${h.toFixed(1)}|${tf}|${op}`; if (key === it.last) continue; it.last = key;
        it.b.style.width = `${w.toFixed(1)}px`; it.b.style.height = `${h.toFixed(1)}px`; it.b.style.transform = tf; it.b.style.opacity = op;
        it.b.tabIndex = u >= 1 ? 0 : -1;
      }
    },
  };
}
