// THE FILM BAR: where a page's scroll bar would be, the whole film from top to bottom: the space station at the top (Jacob's
// art), open space below it, and at the bottom the clouds over the village. A glowing ball comes down it as the film plays:
// at the station through the cabin and out of the window, leaving it with the hangar and the launch, across space through
// the map (its states marked on the way), into the clouds for the dive and down into the village at the cut. The ball shows a pause sign while the
// film plays and is the pause button; paused (by it, or by any other way the film stops), it shows a play sign and plays
// on. Dragging the ball, or pressing anywhere on the bar, takes the film there. On a narrow screen only half of it shows,
// at the edge, so it's not in the way.
//
//   filmBar({ art: { station, village }, stops, marks, film }) -> { el, update() }
//     stops: [[T, piece, frac]] in film order, piece 'station' | 'space' | 'village' and how far down it (0..1): where the
//       ball is at T (in between, it goes evenly)
//     marks: [{ T, label, title }] small labels along the way
//     film: { T(), total(), playing(), live(), pause(), play(), seek(T, dragging) , release() }   (live: the film is over)
const CSS = `
#filmBar { --fbw:54px; --fbb:28px; position:fixed; top:0; right:0; bottom:0; width:var(--fbw); z-index:6; opacity:0; transition:opacity .6s ease, transform .3s ease;
  pointer-events:none; touch-action:none; user-select:none; -webkit-user-select:none; }
#filmBar.on { opacity:1; pointer-events:auto; }
#filmBar .fbTrack { position:absolute; left:50%; width:2px; margin-left:-1px; background:linear-gradient(rgba(170,210,255,.0), rgba(170,210,255,.35) 12%, rgba(170,210,255,.35) 88%, rgba(170,210,255,0)); }
#filmBar img { position:absolute; left:0; width:100%; pointer-events:none; -webkit-user-drag:none; }
#filmBar .fbMark { position:absolute; left:50%; transform:translate(-50%,-50%); font:600 9px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing:.06em;
  color:#dff3ff; background:rgba(8,22,40,.72); border:1px solid rgba(140,200,255,.45); border-radius:7px; padding:2px 4px; }
#filmBar.on.live { pointer-events:none; } #filmBar.on.live .fbBall { pointer-events:auto; }   /* (the film over: only a drag of the ball takes it back) */
#filmBar .fbBall { position:absolute; left:50%; width:var(--fbb); height:var(--fbb); margin:calc(var(--fbb) / -2) 0 0 calc(var(--fbb) / -2); border-radius:50%;
  background:radial-gradient(circle at 35% 30%, #ffffff 0%, #bfe8ff 18%, #4aa8ff 55%, #1b4f9e 100%);
  box-shadow:0 0 10px rgba(110,190,255,.9), 0 0 22px rgba(80,160,255,.5); cursor:grab; display:flex; align-items:center; justify-content:center; border:0; padding:0; }
#filmBar .fbBall:focus-visible { outline:2px solid #bfe8ff; outline-offset:2px; }
#filmBar .fbBall:active { cursor:grabbing; }
#filmBar .fbBall svg { width:46%; height:46%; fill:#05213f; }
#filmBar .fbBall.live svg { opacity:0; }
@media (max-width: 640px) { #filmBar { --fbw:46px; --fbb:32px; transform:translateX(50%); } #filmBar .fbMark { display:none; } }   /* (a phone: half of it at the edge, the labels left off) */
`;
export function filmBar({ art, stops, marks = [], film }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const el = document.createElement('div'); el.id = 'filmBar';
  el.innerHTML = `<div class="fbTrack"></div><img class="fbStation" alt="" src="${art.station}"><img class="fbVillage" alt="" src="${art.village}">`
    + marks.map((m) => `<div class="fbMark" title="${m.title || ''}">${m.label}</div>`).join('')
    + `<button type="button" class="fbBall" aria-label="Pause the film"><svg viewBox="0 0 10 10"></svg></button>`;
  document.body.appendChild(el);
  const ball = el.querySelector('.fbBall'), svg = ball.querySelector('svg'), track = el.querySelector('.fbTrack');
  const imgS = el.querySelector('.fbStation'), imgV = el.querySelector('.fbVillage'), markEls = [...el.querySelectorAll('.fbMark')];
  const ratio = { station: 292 / 249, village: 674 / 256 };            // (the pieces' height over width, as drawn)
  let L = null, shownY = -1, shownGlyph = '';
  // the layout: each piece's top and height down the bar, for the width the bar has now
  function layout() {
    const w = el.clientWidth, h = el.clientHeight, sH = w * ratio.station, vH = w * ratio.village, top = 4;
    L = { h, station: [top, sH], village: [h - vH, vH], space: [top + sH, Math.max(1, h - vH - top - sH)] };
    imgS.style.top = `${L.station[0]}px`; imgS.style.height = `${sH}px`; imgV.style.top = `${L.village[0]}px`; imgV.style.height = `${vH}px`;
    track.style.top = `${L.station[0] + sH * 0.5}px`; track.style.height = `${L.village[0] + vH * 0.3 - (L.station[0] + sH * 0.5)}px`;
    markEls.forEach((m, i) => { m.style.top = `${yAt(marks[i].T)}px`; });
    shownY = -1;
  }
  const yOf = ([, piece, frac]) => L[piece][0] + L[piece][1] * frac;
  // the ball's height for a film time, and back
  function yAt(T) {
    if (T <= stops[0][0]) return yOf(stops[0]);
    for (let i = 1; i < stops.length; i++) if (T <= stops[i][0]) { const a = stops[i - 1], b = stops[i], u = (T - a[0]) / Math.max(1e-6, b[0] - a[0]); return yOf(a) + (yOf(b) - yOf(a)) * u; }
    return yOf(stops[stops.length - 1]);
  }
  function tAt(y) {
    if (y <= yOf(stops[0])) return stops[0][0];
    for (let i = 1; i < stops.length; i++) { const ya = yOf(stops[i - 1]), yb = yOf(stops[i]); if (y <= yb) return stops[i - 1][0] + (stops[i][0] - stops[i - 1][0]) * (yb > ya ? (y - ya) / (yb - ya) : 0); }
    return stops[stops.length - 1][0];
  }
  // pressing: on the ball a tap is pause/play and a drag takes the film along (held where it was grabbed); anywhere else on
  // the bar takes it there. With the film over (the town live) only a deliberate drag of the ball takes it back
  let press = null;
  const toggle = () => { if (film.live()) return; if (film.playing()) film.pause(); else film.play(); };
  el.addEventListener('pointerdown', (e) => {
    if (!el.classList.contains('on')) return;
    e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId);
    const ry = e.clientY - el.getBoundingClientRect().top, onBall = e.target.closest('.fbBall') !== null, live = film.live();
    press = { id: e.pointerId, y: e.clientY, onBall, off: onBall ? ry - yAt(film.T()) : 0, moved: false, live, slop: live ? 16 : e.pointerType === 'mouse' ? 4 : 12 };
    if (!onBall && !live) { press.moved = true; film.seek(tAt(ry), true); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.moved && Math.abs(e.clientY - press.y) < press.slop) return;
    press.moved = true; film.seek(tAt(e.clientY - el.getBoundingClientRect().top - press.off), true);
  });
  const up = (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press; press = null;
    if (p.onBall && !p.moved && e.type !== 'pointercancel') toggle();   // (a cancelled press is no tap)
    else film.release();
  };
  el.addEventListener('click', (e) => { if (e.detail === 0 && e.target.closest('.fbBall')) toggle(); });   // (the keyboard's Enter or Space, a screen reader's press)
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  for (const ev of ['wheel', 'click', 'touchstart']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });   // (the bar's own: not the film's scroll or the town's taps)
  addEventListener('resize', layout);
  imgS.addEventListener('load', layout); imgV.addEventListener('load', layout);
  const GLYPH = { pause: '<rect x="2" y="1.5" width="2.2" height="7" rx=".4"/><rect x="5.8" y="1.5" width="2.2" height="7" rx=".4"/>', play: '<path d="M2.6 1.4 L8.8 5 L2.6 8.6 Z"/>' };
  return {
    el,
    // each frame: shown or not, the ball where the film is, its sign
    update(show) {
      el.classList.toggle('on', !!show); if (el.inert === !!show) el.inert = !show; if (!show) return;   // (hidden: out of the way of keys and screen readers too)
      if (!L || L.h !== el.clientHeight) layout();
      const y = Math.round(yAt(film.T()) * 2) / 2; if (y !== shownY) { shownY = y; ball.style.top = `${y}px`; }
      const live = film.live(), g = live ? 'live' : film.playing() ? 'pause' : 'play';
      if (g !== shownGlyph) { shownGlyph = g; ball.classList.toggle('live', live); el.classList.toggle('live', live); if (!live) svg.innerHTML = GLYPH[g];
        ball.setAttribute('aria-label', live ? 'The film is over: drag up to go back' : g === 'pause' ? 'Pause the film' : 'Play the film'); }
    },
    layout,
  };
}
