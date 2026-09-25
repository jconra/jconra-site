// HTML overlay: top bar, phase banner, the gem info panel, toasts and the modals.
import { GEM_TYPES, SPECIALS, SPECIAL_KEYS, QUALITIES, QUALITY_CHANCES, QUALITY_COSTS, FINAL_WAVE, GEMS_PER_ROUND, waveName, waveKind } from './data.js';
import { gemName, gemStats, gemColor } from './game.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const QCOL = ['#9aa0a6', '#8fd18a', '#6ab0ff', '#c58aff', '#ffb84a'];

function gemIcon(css, q, special) {
  // small inline svg: shape per quality, star for specials
  const shapes = [
    '<polygon points="12,4 19,9 17,18 7,19 4,10" />',
    '<polygon points="12,2 20,12 12,22 4,12" />',
    '<polygon points="4,9 8,5 16,5 20,9 12,21" />',
    '<polygon points="12,1 17,6 17,17 12,23 7,17 7,6" />',
    '<polygon points="12,1 15,8 22,8 16,13 18,21 12,16 6,21 8,13 2,8 9,8" />',
  ];
  const body = special ? '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="11" fill="none" stroke-width="1.5" />' : shapes[q];
  return `<svg class="gi" viewBox="0 0 24 24" fill="${css}" stroke="${css}" stroke-width="0.5">${body}</svg>`;
}
function partIcon(t, q) { return gemIcon(GEM_TYPES[t].css, q, false); }

export class UI {
  constructor(game, actions) {
    this.g = game;
    this.a = actions;
    this.dirty = true;
    this.bind();
  }

  bind() {
    $('#btnQuality').onclick = () => this.openQuality();
    $('#btnRecipes').onclick = () => this.openRecipes();
    $('#btnHelp').onclick = () => this.openHelp();
    $('#btnSound').onclick = () => { this.a.toggleSound(); this.render(); };
    $('#btnGfx').onclick = () => { this.a.toggleGfx(); this.render(); };
    $('#btnPause').onclick = () => { this.a.togglePause(); this.render(); };
    document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { this.a.setSpeed(+b.dataset.speed); this.render(); });
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) this.closeModal(); });
    $('#panelClose').onclick = () => this.a.deselect();
  }

  toast(text, kind = 'info') {
    const box = $('#toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
  }

  render() {
    const g = this.g;
    $('#hWave').textContent = g.phase === 'won' ? `${FINAL_WAVE}` : g.wave;
    $('#hWaveMax').textContent = g.endless ? '∞' : FINAL_WAVE;
    $('#hLives').textContent = g.lives;
    $('#hGold').textContent = Math.floor(g.gold);
    $('#hQual').textContent = g.qLevel;
    const qc = g.qualityCost();
    $('#hQualCost').textContent = qc == null ? 'MAX' : qc;
    $('#btnQuality').classList.toggle('afford', qc != null && g.gold >= qc);
    $('#btnSound').textContent = this.a.isMuted() ? '🔇' : '🔊';
    $('#btnGfx').textContent = this.a.gfxHigh() ? 'HQ' : 'LQ';
    $('#btnPause').textContent = this.a.paused() ? '▶' : '❚❚';
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === this.a.speed()));

    // phase banner
    let title = '', sub = '';
    if (g.phase === 'build') {
      title = `Place your gems <span class="dots">${'◆'.repeat(GEMS_PER_ROUND - g.placesLeft)}<i>${'◇'.repeat(g.placesLeft)}</i></span>`;
      sub = `${this.a.touch() ? 'Tap a hex twice' : 'Click a hex'} to place a random gem · Next: ${esc(waveName(g.wave))}${waveKind(g.wave) === 'bat' ? ' (flying!)' : ''}`;
      if (g.wave === 1) sub = `Wave 1 gift: these five can make a <b style="color:${SPECIALS[g.firstWaveHint].css}">${SPECIALS[g.firstWaveHint].name}</b>. ` + sub;
    } else if (g.phase === 'select') {
      title = 'Choose a gem to keep';
      sub = 'Select one of the new gems, then Keep, Combine or make a Special. The rest become rock.';
    } else if (g.phase === 'wave') {
      const left = g.enemies.filter(e => !e.dead).length + g.spawnQueue.length;
      title = `Wave ${g.wave}: ${esc(g.waveInfo.name)}`;
      sub = `${left} of ${g.waveTotal} remaining`;
    } else if (g.phase === 'over') {
      title = 'Game over'; sub = `You reached wave ${g.wave}`;
    } else if (g.phase === 'won') {
      title = 'Victory!'; sub = `All ${FINAL_WAVE} waves defended`;
    }
    $('#bannerTitle').innerHTML = title;
    $('#bannerSub').innerHTML = sub;
    $('#banner').className = 'phase-' + g.phase;
    this.renderPanel();
  }

  // Cheap refresh for numbers that tick during a wave.
  tick() {
    const g = this.g;
    $('#hGold').textContent = Math.floor(g.gold);
    if (g.phase === 'wave') {
      const left = g.enemies.filter(e => !e.dead).length + g.spawnQueue.length;
      $('#bannerSub').textContent = `${left} of ${g.waveTotal} remaining`;
    }
    const sel = g.selected;
    if (sel && sel.kind === 'gem') {
      const k = $('#pKills'), d = $('#pDmg');
      if (k) k.textContent = sel.kills;
      if (d) d.textContent = fmt(sel.dmgDone);
    }
    $('#btnQuality').classList.toggle('afford', g.qualityCost() != null && g.gold >= g.qualityCost());
    const up = $('#bUpgrade');
    if (up) up.disabled = g.gold < +up.dataset.cost;
  }

  renderPanel() {
    const g = this.g, sel = g.selected;
    const panel = $('#panel');
    if (!sel || !g.gems.has(sel.c + ',' + sel.r)) { panel.classList.remove('open'); return; }
    panel.classList.add('open');
    const body = $('#panelBody');
    let h = '';
    if (sel.kind === 'rock') {
      h += `<div class="ptitle"><span class="swatch" style="background:#8a847c"></span>Rock</div>
        <p class="muted">A wall. Enemies on foot have to walk around it; flyers ignore it.</p>`;
      if (g.canRemoveRock(sel)) h += `<button class="act" data-act="remove">Remove rock <kbd>R</kbd></button>`;
      else h += `<p class="muted small">Rocks can be cleared between waves.</p>`;
      body.innerHTML = h;
      this.wire(body, sel);
      return;
    }
    const s = gemStats(sel);
    const css = gemColor(sel);
    const role = sel.special ? specialRole(s) : GEM_TYPES[sel.type].role;
    const q = sel.special ? null : sel.quality;
    h += `<div class="ptitle">${gemIcon(css, q ?? 0, !!sel.special)}<span style="color:${css}">${esc(gemName(sel))}</span></div>`;
    h += `<div class="prole">${esc(role)}${sel.special ? ` · <span class="lvl">Level ${sel.level + 1}/3</span>` : ` · <span style="color:${QCOL[q]}">${QUALITIES[q]}</span>`}${sel.isNew ? ' · <span class="newtag">NEW</span>' : ''}</div>`;
    const cdEff = s.cd / (sel.speedMult || 1);
    const dm = sel.dmgMult || 1;
    const dmgTxt = s.dmg[0] === s.dmg[1] ? fmt(s.dmg[0] * dm) : `${fmt(s.dmg[0] * dm)}–${fmt(s.dmg[1] * dm)}`;
    h += `<div class="stats">
      <div><b>Damage</b><span>${dmgTxt}${dm > 1 ? ` <em>+${Math.round((dm - 1) * 100)}%</em>` : ''}</span></div>
      <div><b>Cooldown</b><span>${Math.round(cdEff)}ms${sel.speedMult > 1 ? ` <em>+${Math.round((sel.speedMult - 1) * 100)}% speed</em>` : ''}</span></div>
      <div><b>Range</b><span>${s.range}</span></div>
      <div><b>DPS</b><span>${fmt(g.dps(sel))}</span></div>
      <div><b>Kills</b><span id="pKills">${sel.kills}</span></div>
      <div><b>Dealt</b><span id="pDmg">${fmt(sel.dmgDone)}</span></div>
    </div>`;
    const ab = abilities(s);
    if (ab.length) h += `<ul class="abil">${ab.map(a => `<li>${a}</li>`).join('')}</ul>`;

    // actions
    const acts = [];
    if (g.phase === 'select' && sel.isNew) {
      acts.push(`<button class="act primary" data-act="keep">Keep this gem <kbd>Space</kbd></button>`);
      for (const o of g.sameOptions(sel)) {
        const nq = QUALITIES[sel.quality + o.up];
        acts.push(`<button class="act good" data-act="same" data-n="${o.n}">Combine ${o.n}× → ${nq} ${GEM_TYPES[sel.type].name} <kbd>C</kbd></button>`);
      }
      if (!sel.special && sel.quality > 0) acts.push(`<button class="act subtle" data-act="down">Downgrade → ${QUALITIES[sel.quality - 1]} ${GEM_TYPES[sel.type].name} <kbd>X</kbd></button>`);
    }
    for (const o of g.specialOptions(sel)) {
      const sp = SPECIALS[o.key];
      acts.push(`<button class="act special" data-act="special" data-key="${o.key}" style="--c:${sp.css}">✦ Make ${sp.name} <small>this gem upgrades, ${o.parts.length - 1} others become rock</small></button>`);
    }
    if (sel.special) {
      const c = g.upgradeCost(sel);
      if (c != null) acts.push(`<button class="act good" id="bUpgrade" data-act="upgrade" data-cost="${c}" ${g.gold < c ? 'disabled' : ''}>Upgrade → ${esc(SPECIALS[sel.special].levels[sel.level + 1].name)} <span class="cost">${c}g</span> <kbd>U</kbd></button>`);
      else acts.push(`<p class="muted small">Fully upgraded.</p>`);
    }
    if (acts.length) h += `<div class="acts">${acts.join('')}</div>`;
    if (g.phase === 'select' && !sel.isNew && g.newGems.length) h += `<p class="muted small">Pick one of this round's new gems (glowing rings) to keep.</p>`;

    // recipe hints
    const hints = g.recipeHints(sel);
    if (hints.length) {
      h += `<div class="hints"><div class="htitle">Special recipes using this gem</div>`;
      for (const r of hints) {
        const sp = SPECIALS[r.key];
        h += `<div class="hint"><span class="hname" style="color:${sp.css}">${sp.name}</span> ` +
          r.need.map(n => `<span class="ing ${n.have ? 'have' : ''} ${n.self ? 'self' : ''}" title="${QUALITIES[n.q]} ${GEM_TYPES[n.t].name}">${partIcon(n.t, n.q)}<small>${QUALITIES[n.q][0]}${n.q === 3 ? 'l' : ''}</small></span>`).join('') + '</div>';
      }
      h += '</div>';
    }
    body.innerHTML = h;
    this.wire(body, sel);
  }

  wire(body, sel) {
    body.querySelectorAll('[data-act]').forEach(b => {
      const act = b.dataset.act;
      b.onclick = () => {
        if (act === 'keep') this.g.keep(sel);
        else if (act === 'same') this.g.combineSame(sel, +b.dataset.n);
        else if (act === 'down') this.g.downgrade(sel);
        else if (act === 'special') this.g.makeSpecial(sel, b.dataset.key);
        else if (act === 'upgrade') this.g.upgradeSpecial(sel);
        else if (act === 'remove') this.g.removeRock(sel);
        this.a.highlightParts(null);
      };
      if (act === 'special') {
        const parts = () => (this.g.specialOptions(sel).find(o => o.key === b.dataset.key) || {}).parts;
        b.onpointerenter = () => this.a.highlightParts(parts());
        b.onpointerleave = () => this.a.highlightParts(null);
      }
    });
  }

  openModal(html) {
    $('#modalBody').innerHTML = html;
    $('#modal').classList.add('open');
  }
  closeModal() { $('#modal').classList.remove('open'); this.a.onModalClose && this.a.onModalClose(); }
  modalOpen() { return $('#modal').classList.contains('open'); }

  openQuality() {
    const g = this.g;
    const c = g.qualityCost();
    let h = `<h2>Gem Quality</h2><p class="muted">Raises the odds that the gems you place come out better. Current level: <b>${g.qLevel}</b></p>`;
    h += '<table class="qt"><tr><th></th>';
    for (let l = 0; l <= 8; l++) h += `<th class="${l === g.qLevel ? 'cur' : ''}">Lv ${l}${l ? `<small>${QUALITY_COSTS[l - 1]}g</small>` : ''}</th>`;
    h += '</tr>';
    for (let q = 0; q < 5; q++) {
      h += `<tr><td style="color:${QCOL[q]}">${QUALITIES[q]}</td>`;
      for (let l = 0; l <= 8; l++) h += `<td class="${l === g.qLevel ? 'cur' : ''} ${QUALITY_CHANCES[q][l] ? '' : 'zero'}">${QUALITY_CHANCES[q][l]}%</td>`;
      h += '</tr>';
    }
    h += '</table>';
    h += c == null ? '<p>Maxed out.</p>' : `<button class="act primary" id="mBuyQ" ${g.gold < c ? 'disabled' : ''}>Upgrade to level ${g.qLevel + 1} for ${c} gold <kbd>G</kbd></button>`;
    h += '<button class="act subtle" data-close>Close</button>';
    this.openModal(h);
    const b = $('#mBuyQ');
    if (b) b.onclick = () => { g.buyQuality(); this.openQuality(); };
  }

  openRecipes() {
    const g = this.g;
    const owned = [...g.gems.values()].filter(x => x.kind === 'gem' && !x.special);
    let h = '<h2>Special gem recipes</h2><p class="muted">Get every ingredient on the board, click one of them, and choose the special. The gem you clicked becomes the special; the others turn to rock. Ticked ingredients are on your board now.</p><div class="recipes">';
    for (const k of SPECIAL_KEYS) {
      const sp = SPECIALS[k], L = sp.levels[0];
      const used = new Set();
      const parts = sp.recipe.map(([t, q]) => {
        const m = owned.find(o => !used.has(o.id) && o.type === t && o.quality === q);
        if (m) used.add(m.id);
        return `<span class="ing ${m ? 'have' : ''}">${partIcon(t, q)} ${QUALITIES[q]} ${GEM_TYPES[t].name}</span>`;
      });
      h += `<div class="recipe"><div class="rname" style="color:${sp.css}">${gemIcon(sp.css, 0, true)} ${sp.name}</div>
        <div class="rparts">${parts.join('<b>+</b>')}</div>
        <div class="rstats">Dmg ${L.dmg[0]}${L.dmg[1] !== L.dmg[0] ? '–' + L.dmg[1] : ''} · ${L.cd}ms · Range ${L.range}</div>
        <div class="rab">${abilities(L).join(' · ')}</div>
        <div class="rlv muted small">Upgrades: ${sp.levels.slice(1).map((x, i) => `${x.name} (${sp.cost[i]}g)`).join(' → ')}</div></div>`;
    }
    h += '</div><button class="act subtle" data-close>Close</button>';
    this.openModal(h);
  }

  openHelp() {
    const t = this.a.touch();
    this.openModal(`<h2>How to play</h2>
      <ol class="help">
        <li><b>Place 5 gems.</b> ${t ? 'Tap a hex twice' : 'Click a hex'} to drop a random gem. Every placement must leave a walking path from the cave, through pads 1→6, to the portal.</li>
        <li><b>Keep one.</b> Select a new gem and press Keep. The other four turn to rock, which becomes your maze.</li>
        <li><b>Combine.</b> Two of the same new gem combine into the next quality (four jump two). A full special recipe on the board makes a special gem.</li>
        <li><b>Defend.</b> Ground enemies walk the maze; flyers go straight from pad to pad. Diamonds can't hit flyers; Amethysts only hit flyers.</li>
        <li><b>Spend gold</b> on Gem Quality for better odds, and on upgrading special gems.</li>
      </ol>
      <h3>Controls</h3>
      <table class="keys">
        <tr><td>${t ? 'Drag' : 'Drag / WASD / arrows'}</td><td>Pan</td></tr>
        <tr><td>${t ? 'Pinch' : 'Wheel / + −'}</td><td>Zoom</td></tr>
        <tr><td>${t ? 'Two-finger twist' : 'Right-drag / Q E'}</td><td>Rotate</td></tr>
        <tr><td>Space</td><td>Keep selected gem</td></tr>
        <tr><td>C / X</td><td>Combine / downgrade</td></tr>
        <tr><td>U / G / R</td><td>Upgrade special / Gem Quality / remove rock</td></tr>
        <tr><td>1 2 3 · P</td><td>Game speed · pause</td></tr>
        <tr><td>B · H · Esc</td><td>Recipes · help · deselect</td></tr>
      </table>
      <h3>Status colours</h3>
      <p class="status"><span style="color:#3cff4a">■ poison</span> <span style="color:#6ad8ff">■ slowed/frozen</span> <span style="color:#ff6a1a">■ burning</span> <span style="color:#c8ff1a">■ radiation</span> <span style="color:#fff4a0">■ stunned</span> <span style="color:#c060ff">■ armor broken</span></p>
      <button class="act primary" data-close>Let's go</button>`);
  }

  openEnd(won) {
    const g = this.g;
    this.openModal(`<h2>${won ? 'Victory!' : 'Game over'}</h2>
      <p>${won ? `You held all ${FINAL_WAVE} waves.` : `The gems fell on wave ${g.wave}.`}</p>
      <p class="muted">Kills: ${g.stats.kills} · Escaped: ${g.stats.leaked} · Gem Quality: ${g.qLevel}</p>
      ${won ? '<button class="act good" id="mEndless">Keep going (endless)</button>' : ''}
      <button class="act primary" id="mRestart">New game</button>`);
    $('#mRestart').onclick = () => { this.closeModal(); this.a.restart(); };
    const e = $('#mEndless');
    if (e) e.onclick = () => { this.closeModal(); g.continueEndless(); };
  }
}

function fmt(n) {
  if (n >= 100000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  if (n >= 100) return Math.round(n).toString();
  return (Math.round(n * 10) / 10).toString();
}

function specialRole(s) {
  if (s.airOnly) return 'Special · air only';
  if (s.groundOnly) return 'Special · ground only';
  return 'Special gem';
}

function abilities(s) {
  const a = [];
  if (s.groundOnly) a.push('Hits <b>ground</b> enemies only');
  if (s.airOnly) a.push('Hits <b>flying</b> enemies only');
  if (s.targets > 1) a.push(`Attacks <b>${s.targets}</b> enemies at once`);
  if (s.splash && !s.splashSlow) a.push(`Splash: ${Math.round((s.splashPct ?? 0.5) * 100)}% damage within ${s.splash}`);
  if (s.crit) a.push(`<b>${Math.round(s.crit * 100)}%</b> chance of ${s.critMult}× damage`);
  if (s.slow && !s.poison) a.push(`Slows by <b>${Math.round(s.slow * 100)}%</b> for ${s.slowDur}s`);
  if (s.poison) a.push(`Poison <b>${s.poison}</b>/s, slows ${Math.round(s.slow * 100)}% for ${s.slowDur}s`);
  if (s.speedAura) a.push(`Aura: nearby gems attack <b>${Math.round(s.speedAura * 100)}%</b> faster (${s.auraRange})`);
  if (s.dmgAura) a.push(`Aura: nearby gems deal <b>+${Math.round(s.dmgAura * 100)}%</b> damage (${s.auraRange})`);
  if (s.burn) a.push(`Sets targets burning for <b>${s.burn}</b>/s`);
  if (s.burnAura) a.push(`Burn aura: <b>${s.burnAura}</b>/s to enemies within ${s.auraRange}`);
  if (s.slowAura) a.push(`Slow aura: <b>${Math.round(s.slowAura * 100)}%</b> within ${s.auraRange}`);
  if (s.stun) a.push(`${(s.stun * 100).toFixed(1).replace('.0', '')}% chance to stun for ${s.stunDur}s`);
  if (s.splashSlow) a.push(`Splash slow: <b>${Math.round(s.splashSlow * 100)}%</b> within ${s.splash}`);
  if (s.airArmor) a.push(`Air aura: <b>−${s.airArmor}</b> armor to flyers within ${s.auraRange}`);
  if (s.groundArmor) a.push(`Ground aura: <b>−${s.groundArmor}</b> armor within ${s.auraRange}`);
  if (s.nova) a.push(`${Math.round(s.nova * 100)}% chance: <b>${s.novaDmg}</b>-damage frost nova`);
  if (s.bonusGold) a.push(`+${s.bonusGold} gold per kill`);
  return a;
}
