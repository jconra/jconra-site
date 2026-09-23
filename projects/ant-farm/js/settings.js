/* A collapsible settings panel, folded into the top-right corner.
 *
 * Every control writes straight into CFG, the same object the simulation and
 * the renderer read every frame, so most changes take effect on the very next
 * step - drag "chamber size" and the next room the colony plans is bigger.  A
 * few constants are only read when the world is built (grain size, how much of
 * the tank is sand); those are marked `rebuild` and restart the farm on change,
 * which is the honest thing to do since there is no way to resize a live grid.
 *
 * Deliberately plain DOM and inline styles: the whole project runs from a
 * file:// URL with no build step, and the panel has to as well.
 */
(function (root) {
  'use strict';
  var CFG = root.CFG;

  /* The groups of controls.  `key` is the CFG field; `min`/`max`/`step` bound
   * the slider; `rebuild` rebuilds the world on change; `fmt` formats the
   * read-out.  Kept declarative so a new knob is one line, not a new widget. */
  var pct = function (v) { return (v * 100).toFixed(0) + '%'; };
  var GROUPS = [
    { title: 'Nest shape', rows: [
      { key: 'maxActiveDigs', label: 'Open tunnels at once', min: 1, max: 10, step: 1,
        hint: 'Fewer = a clean nest; more = a busy scribble' },
      { key: 'branchChance', label: 'Branchiness', min: 0, max: 0.6, step: 0.02, fmt: pct,
        hint: 'How often a gallery throws a side branch' },
      { key: 'workDepthMax', label: 'Max depth', min: 0.3, max: 0.98, step: 0.02, fmt: pct,
        hint: 'Deepest the nest digs under the hill, down the sand column' },
      { key: 'workLateralCost', label: 'Taper to the sides', min: 0, max: 1.2, step: 0.05,
        hint: 'Depth given up per cell of walk from the entrance. 0 = a flat floor' },
      { key: 'workFloorWobble', label: 'Uneven floor', min: 0, max: 0.4, step: 0.02, fmt: pct,
        hint: 'How ragged the bottom edge of the nest is' },
      { key: 'clearance', label: 'Wall between tunnels', min: 1, max: 5, step: 1,
        hint: 'Cells of rock kept between galleries' }
    ] },
    { title: 'Chambers', rows: [
      { key: 'roomScale', label: 'Chamber size', min: 0.6, max: 2.0, step: 0.05, fmt: pct,
        hint: 'Scales every room; bigger reads clearly as a room' },
      { key: 'nurseryRy', label: 'Nursery headroom', min: 1, max: 5, step: 0.1,
        fmt: function (v) { return (v * 2 * CFG.roomScale * CFG.cell).toFixed(0) + 'px'; },
        hint: 'How tall a nursery is dug - the queen needs room to sit in one' },
      { key: 'chamberReadyFraction', label: 'Finish before use', min: 0.2, max: 0.95, step: 0.05, fmt: pct,
        hint: 'How dug-out a chamber must be before brood goes in' },
      { key: 'eggsPerNursery', label: 'Most brood per nursery', min: 3, max: 24, step: 1,
        hint: 'Ceiling on one nursery; a small one holds less, by its floor' },
      { key: 'broodPerFloorCell', label: 'Brood per floor cell', min: 0.2, max: 2, step: 0.05,
        hint: 'How densely brood piles up - what makes nursery space the limit' }
    ] },
    { title: 'Brood carrying', rows: [
      { key: 'broodMoveEagerness', label: 'Carry brood about', min: 0, max: 4, step: 0.1,
        hint: 'How keen nurses are to pick brood up and sort it' },
      { key: 'broodMoveCooldown', label: 'Leave settled brood', min: 2, max: 60, step: 1,
        fmt: function (v) { return v.toFixed(0) + 's'; },
        hint: 'Seconds an item is left alone after being moved' },
      { key: 'broodAlarmUrgency', label: 'Evacuate when alarmed', min: 0, max: 6, step: 0.2,
        hint: 'Extra keenness to run brood deeper under attack' }
    ] },
    { title: 'Sizes on screen', rows: [
      { key: 'eggSize', label: 'Egg size', min: 2, max: 12, step: 0.2,
        fmt: function (v) { return v.toFixed(1) + 'px'; }, hint: 'Egg half-length' },
      { key: 'broodScale', label: 'Larva / pupa size', min: 0.6, max: 2.5, step: 0.05, fmt: pct },
      { key: 'foodSize', label: 'Leaf size', min: 2, max: 12, step: 0.2,
        fmt: function (v) { return v.toFixed(1) + 'px'; }, hint: 'Half-length of a leaf scrap' }
    ] },
    { title: 'Food', rows: [
      { key: 'clickFlakes', label: 'Scraps per click', min: 1, max: 20, step: 1,
        hint: 'How much food a click drops' },
      { key: 'foodSpawnInterval', label: 'Windfall every', min: 20, max: 600, step: 10,
        fmt: function (v) { return v.toFixed(0) + 's'; },
        hint: 'Chance food that blows in on its own; high = you feed them yourself' },
      { key: 'recruitStrength', label: 'Recruitment', min: 0, max: 5, step: 0.1,
        hint: 'How strongly food scent pulls nestmates into foraging' },
      { key: 'torporSpeed', label: 'Famine slowdown', min: 0.1, max: 1, step: 0.05, fmt: pct,
        hint: 'Walking pace at full famine; low = a hungry nest visibly slows' }
    ] },
    { title: 'Life', rows: [
      { key: 'maxAnts', label: 'Colony cap', min: 8, max: 120, step: 1, hint: 'Most ants the colony reaches' },
      { key: 'layInterval', label: 'Laying interval', min: 3, max: 30, step: 1,
        fmt: function (v) { return v.toFixed(0) + 's'; }, hint: 'Seconds between the queen laying' },
      { key: 'broodTimeScale', label: 'Brood development', min: 0.25, max: 8, step: 0.25,
        fmt: function (v) {
          var s = (CFG.eggSeconds + CFG.larvaSeconds + CFG.pupaSeconds) * v;
          return v.toFixed(2) + 'x  (' + s.toFixed(0) + 's egg to adult)';
        },
        hint: 'Stretches egg, larva and pupa together; tending still speeds it up' },
      { key: 'growSeconds', label: 'Grow to full size', min: 20, max: 600, step: 10,
        fmt: function (v) { return v.toFixed(0) + 's'; },
        hint: 'How long a pale callow takes to fill out to an adult' },
      { key: 'timeScale', label: 'Speed', min: 0.1, max: 3, step: 0.05,
        fmt: function (v) { return v.toFixed(2) + 'x'; },
        hint: 'Simulated seconds per real second - low = a slow, hours-long colony' }
    ] },
    { title: 'World  (restarts colony)', rows: [
      { key: 'sandFraction', label: 'Sand fills', min: 0.4, max: 0.9, step: 0.02, fmt: pct, rebuild: true },
      { key: 'cell', label: 'Grain size', min: 2, max: 8, step: 1,
        fmt: function (v) { return v.toFixed(0) + 'px'; }, rebuild: true }
    ] }
  ];

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }

  function build() {
    var defaults = {};
    GROUPS.forEach(function (g) { g.rows.forEach(function (r) { defaults[r.key] = CFG[r.key]; }); });

    var panel = el('div',
      'position:fixed;top:8px;right:8px;z-index:10;width:250px;' +
      'font:11px/1.4 ui-monospace,"DejaVu Sans Mono",Menlo,monospace;' +
      'color:#cdd7dc;background:rgba(8,12,16,0.82);border:1px solid rgba(120,135,145,0.25);' +
      'border-radius:6px;cursor:auto;user-select:none;-webkit-user-select:none;' +
      'box-shadow:0 4px 18px rgba(0,0,0,0.4);');

    // ---- header / toggle
    var head = el('div',
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:7px 10px;cursor:pointer;color:#f0e1be;letter-spacing:0.04em;');
    head.appendChild(el('span', '', 'settings'));
    var chevron = el('span', 'transition:transform 0.15s;', '▼');
    head.appendChild(chevron);
    panel.appendChild(head);

    var bodyWrap = el('div', 'max-height:78vh;overflow-y:auto;padding:2px 10px 8px;');
    panel.appendChild(bodyWrap);

    var collapsed = false;
    function setCollapsed(c) {
      collapsed = c;
      bodyWrap.style.display = c ? 'none' : 'block';
      chevron.style.transform = c ? 'rotate(-90deg)' : 'none';
    }
    head.addEventListener('click', function () { setCollapsed(!collapsed); });

    var refreshers = [];
    function refreshAll() { refreshers.forEach(function (f) { f(); }); }

    // ---- groups
    GROUPS.forEach(function (group) {
      bodyWrap.appendChild(el('div',
        'margin:9px 0 3px;color:#8fa0a8;text-transform:uppercase;font-size:9px;letter-spacing:0.08em;',
        group.title));
      group.rows.forEach(function (r) { bodyWrap.appendChild(makeRow(r)); });
    });

    // ---- reset
    var reset = el('button',
      'margin:12px 0 2px;width:100%;padding:5px;cursor:pointer;' +
      'font:inherit;color:#cdd7dc;background:rgba(60,72,80,0.6);' +
      'border:1px solid rgba(120,135,145,0.3);border-radius:4px;', 'reset to defaults');
    reset.addEventListener('click', function () {
      Object.keys(defaults).forEach(function (k) { CFG[k] = defaults[k]; });
      refreshAll();
      if (root.farm) root.farm.restart();
    });
    bodyWrap.appendChild(reset);

    function makeRow(r) {
      var wrap = el('div', 'margin:6px 0;');
      var top = el('div', 'display:flex;justify-content:space-between;');
      var name = el('span', '', r.label);
      if (r.hint) name.title = r.hint;
      var val = el('span', 'color:#f0e1be;');
      top.appendChild(name);
      top.appendChild(val);
      wrap.appendChild(top);

      var slider = el('input', 'width:100%;margin:2px 0 0;cursor:pointer;');
      slider.type = 'range';
      slider.min = r.min; slider.max = r.max; slider.step = r.step;

      function show() {
        val.textContent = r.fmt ? r.fmt(CFG[r.key]) : (CFG[r.key] + '');
      }
      function sync() { slider.value = CFG[r.key]; show(); }
      refreshers.push(sync);
      sync();

      slider.addEventListener('input', function () {
        CFG[r.key] = parseFloat(slider.value);
        show();
        if (r.rebuild && root.farm) {
          // recompute the derived height and rebuild the world
          CFG.antAdultHeight = CFG.antAdultLen * CFG.antHeightRatio;
          root.farm.restart();
        }
      });
      wrap.appendChild(slider);
      return wrap;
    }

    document.body.appendChild(panel);
    // the tank hides the cursor; the panel must show it, so it can be used
    panel.addEventListener('mouseenter', function () { document.body.style.cursor = 'auto'; });
    panel.addEventListener('mouseleave', function () { document.body.style.cursor = 'none'; });
    root.settingsPanel = { setCollapsed: setCollapsed, refresh: refreshAll };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else build();
})(window);
