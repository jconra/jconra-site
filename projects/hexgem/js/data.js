// Hex Gem Defense: every number the game is balanced on lives here.

export const QUALITIES = ['Chipped', 'Flawed', 'Normal', 'Flawless', 'Perfect'];

// Range values are in the original "pixel" units; this many of them span one hex.
export const RANGE_PER_HEX = 18;

export const GEM_TYPES = {
  ruby: {
    name: 'Ruby', color: 0xff2350, css: '#ff2350', role: 'Splash damage',
    q: [
      { dmg: [8, 9], cd: 1000, range: 114, splash: 36 },
      { dmg: [13, 16], cd: 1000, range: 114, splash: 40 },
      { dmg: [20, 25], cd: 1000, range: 114, splash: 45 },
      { dmg: [28, 45], cd: 1000, range: 114, splash: 50 },
      { dmg: [80, 104], cd: 1000, range: 129, splash: 60 },
    ],
    all: { splashPct: 0.5 },
  },
  topaz: {
    name: 'Topaz', color: 0xffc21a, css: '#ffc21a', role: 'Hits several targets at once',
    q: [
      { dmg: [4, 4], cd: 800, range: 72, targets: 2 },
      { dmg: [8, 8], cd: 1000, range: 72, targets: 3 },
      { dmg: [14, 14], cd: 1000, range: 72, targets: 4 },
      { dmg: [25, 25], cd: 800, range: 72, targets: 5 },
      { dmg: [75, 75], cd: 1000, range: 86, targets: 6 },
    ],
  },
  aquamarine: {
    name: 'Aquamarine', color: 0x12c4b8, css: '#3ff0dc', role: 'Very fast attacks',
    q: [
      { dmg: [6, 8], cd: 350, range: 50 },
      { dmg: [12, 15], cd: 350, range: 52 },
      { dmg: [24, 30], cd: 350, range: 54 },
      { dmg: [48, 55], cd: 350, range: 61 },
      { dmg: [110, 132], cd: 227, range: 79 },
    ],
  },
  sapphire: {
    name: 'Sapphire', color: 0x2f62ff, css: '#4a78ff', role: 'Slows its target',
    q: [
      { dmg: [5, 8], cd: 1000, range: 72, slow: 0.2, slowDur: 2 },
      { dmg: [10, 13], cd: 1000, range: 107, slow: 0.25, slowDur: 2 },
      { dmg: [18, 23], cd: 1000, range: 114, slow: 0.3, slowDur: 2 },
      { dmg: [30, 40], cd: 1000, range: 122, slow: 0.35, slowDur: 2.5 },
      { dmg: [60, 75], cd: 750, range: 200, slow: 0.45, slowDur: 3 },
    ],
  },
  diamond: {
    name: 'Diamond', color: 0xf2f6ff, css: '#f2f6ff', role: 'Ground only, 25% chance of double damage',
    q: [
      { dmg: [8, 12], cd: 800, range: 72 },
      { dmg: [16, 18], cd: 1000, range: 79 },
      { dmg: [30, 37], cd: 1000, range: 86 },
      { dmg: [58, 65], cd: 1000, range: 93 },
      { dmg: [140, 150], cd: 1000, range: 107 },
    ],
    all: { groundOnly: true, crit: 0.25, critMult: 2 },
  },
  amethyst: {
    name: 'Amethyst', color: 0xff5fd2, css: '#ff5fd2', role: 'Air only, long range',
    q: [
      { dmg: [9, 13], cd: 800, range: 143 },
      { dmg: [20, 27], cd: 750, range: 161 },
      { dmg: [30, 40], cd: 1000, range: 179 },
      { dmg: [60, 75], cd: 1000, range: 186 },
      { dmg: [140, 150], cd: 1000, range: 215 },
    ],
    all: { airOnly: true },
  },
  opal: {
    name: 'Opal', color: 0x3d9478, css: '#8fbfb0', role: 'Aura: speeds up nearby gems',
    q: [
      { dmg: [5, 5], cd: 800, range: 86, speedAura: 0.10, auraRange: 86 },
      { dmg: [10, 10], cd: 1000, range: 100, speedAura: 0.15, auraRange: 100 },
      { dmg: [20, 20], cd: 1000, range: 114, speedAura: 0.20, auraRange: 115 },
      { dmg: [40, 40], cd: 750, range: 129, speedAura: 0.25, auraRange: 129 },
      { dmg: [85, 85], cd: 650, range: 143, speedAura: 0.35, auraRange: 143 },
    ],
  },
  emerald: {
    name: 'Emerald', color: 0x22d65a, css: '#22d65a', role: 'Poisons and slows',
    q: [
      { dmg: [4, 7], cd: 800, range: 72, poison: 2, slow: 0.15, slowDur: 3 },
      { dmg: [10, 13], cd: 1000, range: 79, poison: 3, slow: 0.20, slowDur: 4 },
      { dmg: [15, 25], cd: 1000, range: 86, poison: 5, slow: 0.25, slowDur: 5 },
      { dmg: [30, 38], cd: 750, range: 100, poison: 8, slow: 0.35, slowDur: 6 },
      { dmg: [80, 90], cd: 750, range: 114, poison: 16, slow: 0.50, slowDur: 8 },
    ],
  },
};
export const TYPE_KEYS = Object.keys(GEM_TYPES);

// Special gems. `recipe` lists [type, quality]; each has three levels, bought with gold.
export const SPECIALS = {
  malachite: {
    name: 'Malachite', color: 0x16c86a, css: '#16c86a',
    recipe: [['opal', 0], ['emerald', 0], ['aquamarine', 0]],
    cost: [60, 150],
    levels: [
      { name: 'Malachite', dmg: [5, 6], cd: 350, range: 107, targets: 3 },
      { name: 'Vivid Malachite', dmg: [12, 14], cd: 330, range: 114, targets: 4 },
      { name: 'Mighty Malachite', dmg: [30, 35], cd: 300, range: 122, targets: 5 },
    ],
  },
  silver: {
    name: 'Silver', color: 0xc9d1dc, css: '#c9d1dc',
    recipe: [['topaz', 0], ['diamond', 0], ['sapphire', 0]],
    cost: [60, 150],
    levels: [
      { name: 'Silver', dmg: [19, 21], cd: 1000, range: 79, splashSlow: 0.2, splash: 36, slowDur: 2 },
      { name: 'Sterling Silver', dmg: [45, 50], cd: 900, range: 86, splashSlow: 0.25, splash: 50, slowDur: 2 },
      { name: 'Silver Knight', dmg: [110, 125], cd: 800, range: 100, splashSlow: 0.3, splash: 64, slowDur: 2 },
    ],
  },
  starRuby: {
    name: 'Star Ruby', color: 0xff3a5c, css: '#ff3a5c',
    recipe: [['ruby', 1], ['ruby', 0], ['amethyst', 0]],
    cost: [100, 220],
    levels: [
      { name: 'Star Ruby', dmg: [10, 11], cd: 250, range: 38, burnAura: 40, auraRange: 38 },
      { name: 'Blood Star', dmg: [20, 22], cd: 250, range: 45, burnAura: 90, auraRange: 45 },
      { name: 'Fire Star', dmg: [40, 45], cd: 220, range: 52, burnAura: 200, auraRange: 52 },
    ],
  },
  jade: {
    name: 'Jade', color: 0x21b07a, css: '#21b07a',
    recipe: [['emerald', 2], ['opal', 2], ['sapphire', 1]],
    cost: [100, 220],
    levels: [
      { name: 'Jade', dmg: [29, 35], cd: 500, range: 114, poison: 5, slow: 0.5, slowDur: 2 },
      { name: 'Asian Jade', dmg: [40, 46], cd: 420, range: 118, poison: 10, slow: 0.5, slowDur: 2 },
      { name: 'Lucky Asian Jade', dmg: [55, 55], cd: 350, range: 122, poison: 15, slow: 0.5, slowDur: 2, bonusGold: 2 },
    ],
  },
  blackOpal: {
    name: 'Black Opal', color: 0x24203a, css: '#8a7cff',
    recipe: [['opal', 4], ['diamond', 3], ['aquamarine', 2]],
    cost: [250, 400],
    levels: [
      { name: 'Black Opal', dmg: [24, 24], cd: 1000, range: 114, dmgAura: 0.30, auraRange: 143 },
      { name: 'Mystic Black Opal', dmg: [60, 60], cd: 1000, range: 122, dmgAura: 0.40, auraRange: 160 },
      { name: 'Eternal Black Opal', dmg: [120, 120], cd: 900, range: 129, dmgAura: 0.50, auraRange: 180 },
    ],
  },
  bloodStone: {
    name: 'Blood Stone', color: 0x9a0a14, css: '#d0202c',
    recipe: [['ruby', 4], ['aquamarine', 3], ['amethyst', 2]],
    cost: [250, 400],
    levels: [
      { name: 'Blood Stone', dmg: [67, 67], cd: 500, range: 100, burn: 135, burnDur: 2, splash: 57, splashPct: 0.6 },
      { name: 'Ancient Blood Stone', dmg: [120, 120], cd: 500, range: 107, burn: 220, burnDur: 2, splash: 64, splashPct: 0.6 },
      { name: 'Crimson Heart', dmg: [220, 220], cd: 450, range: 114, burn: 380, burnDur: 2, splash: 72, splashPct: 0.6 },
    ],
  },
  darkEmerald: {
    name: 'Dark Emerald', color: 0x0a6b2c, css: '#1b9e4a',
    recipe: [['emerald', 4], ['sapphire', 3], ['topaz', 1]],
    cost: [250, 400],
    levels: [
      { name: 'Dark Emerald', dmg: [89, 150], cd: 800, range: 79, stun: 0.125, stunDur: 1 },
      { name: 'Enchanted Emerald', dmg: [170, 260], cd: 800, range: 86, stun: 0.15, stunDur: 1 },
      { name: 'Emerald Golem', dmg: [300, 450], cd: 700, range: 93, stun: 0.2, stunDur: 1.2 },
    ],
  },
  gold: {
    name: 'Gold', color: 0xffc83a, css: '#ffc83a',
    recipe: [['amethyst', 4], ['amethyst', 3], ['diamond', 1]],
    cost: [250, 400],
    levels: [
      { name: 'Gold', dmg: [159, 190], cd: 1000, range: 114, crit: 0.25, critMult: 2 },
      { name: 'Egyptian Gold', dmg: [290, 340], cd: 1000, range: 118, crit: 0.3, critMult: 2 },
      { name: "Pharaoh's Gold", dmg: [520, 600], cd: 900, range: 122, crit: 0.3, critMult: 2.5 },
    ],
  },
  pinkDiamond: {
    name: 'Pink Diamond', color: 0xff9ed8, css: '#ff9ed8',
    recipe: [['diamond', 4], ['topaz', 2], ['diamond', 2]],
    cost: [250, 400],
    levels: [
      { name: 'Pink Diamond', dmg: [149, 175], cd: 750, range: 114, groundOnly: true, crit: 0.10, critMult: 5 },
      { name: 'Great Pink Diamond', dmg: [260, 300], cd: 750, range: 118, groundOnly: true, crit: 0.12, critMult: 5 },
      { name: 'Royal Pink Diamond', dmg: [450, 520], cd: 700, range: 122, groundOnly: true, crit: 0.15, critMult: 5 },
    ],
  },
  redCrystal: {
    name: 'Red Crystal', color: 0xff2a2a, css: '#ff4a4a',
    recipe: [['ruby', 2], ['emerald', 3], ['amethyst', 1]],
    cost: [250, 400],
    levels: [
      { name: 'Red Crystal', dmg: [49, 75], cd: 800, range: 186, airOnly: true, airArmor: 5, auraRange: 200 },
      { name: 'Rose Quartz Crystal', dmg: [100, 140], cd: 800, range: 193, airOnly: true, airArmor: 6, auraRange: 200 },
      { name: 'Crimson Prism', dmg: [190, 260], cd: 700, range: 200, airOnly: true, airArmor: 7, auraRange: 215 },
    ],
  },
  uranium: {
    name: 'Uranium 238', color: 0xa6ff1a, css: '#a6ff1a',
    recipe: [['topaz', 4], ['sapphire', 2], ['opal', 1]],
    cost: [250, 400],
    levels: [
      { name: 'Uranium 238', dmg: [64, 65], cd: 250, range: 86, slowAura: 0.5, burnAura: 260, auraRange: 64 },
      { name: 'Uranium 235', dmg: [110, 112], cd: 250, range: 90, slowAura: 0.5, burnAura: 420, auraRange: 68 },
      { name: 'Plutonium', dmg: [180, 185], cd: 250, range: 93, slowAura: 0.5, burnAura: 650, auraRange: 72 },
    ],
  },
  yellowSapphire: {
    name: 'Yellow Sapphire', color: 0xffe23a, css: '#ffe23a',
    recipe: [['sapphire', 4], ['topaz', 3], ['ruby', 3]],
    cost: [250, 400],
    levels: [
      { name: 'Yellow Sapphire', dmg: [99, 100], cd: 1000, range: 114, splashSlow: 0.2, splash: 57, slowDur: 2 },
      { name: 'Star Yellow Sapphire', dmg: [190, 200], cd: 1000, range: 118, splashSlow: 0.25, splash: 64, slowDur: 2 },
      { name: 'Royal Yellow Sapphire', dmg: [360, 380], cd: 900, range: 122, splashSlow: 0.3, splash: 72, slowDur: 2 },
    ],
  },
  paraiba: {
    name: 'Paraiba Tourmaline', color: 0x19e6ff, css: '#19e6ff',
    recipe: [['aquamarine', 4], ['opal', 3], ['emerald', 1], ['aquamarine', 1]],
    cost: [250, 400],
    levels: [
      { name: 'Paraiba Tourmaline', dmg: [25, 105], cd: 750, range: 122, groundArmor: 4, auraRange: 86, nova: 0.33, novaDmg: 100, novaRadius: 60 },
      { name: 'Elaborate Paraiba', dmg: [60, 200], cd: 750, range: 126, groundArmor: 5, auraRange: 93, nova: 0.33, novaDmg: 200, novaRadius: 64 },
      { name: 'Paraiba Crown', dmg: [120, 380], cd: 700, range: 129, groundArmor: 6, auraRange: 100, nova: 0.33, novaDmg: 400, novaRadius: 72 },
    ],
  },
};
export const SPECIAL_KEYS = Object.keys(SPECIALS);

// Gem Quality upgrades: cost of each level, then the chance of each quality at levels 0..8.
export const QUALITY_COSTS = [20, 50, 80, 110, 140, 170, 200, 230];
export const QUALITY_CHANCES = [
  [100, 70, 60, 50, 40, 30, 20, 10, 0],
  [0, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 0, 10, 20, 20, 30, 30, 30, 30],
  [0, 0, 0, 0, 10, 10, 20, 30, 30],
  [0, 0, 0, 0, 0, 0, 0, 0, 10],
];

export const START_LIVES = 20;
export const START_GOLD = 0;
export const FINAL_WAVE = 50;
export const GEMS_PER_ROUND = 5;

export const killGold = wave => 1.5 + 0.25 * (wave - 1);
export const roundGold = wave => 10 + 2 * (wave - 1);

export const ENEMY_KINDS = {
  crawler: { name: 'Crawlers', hp: 1.0, speed: 1.9, armor: 0, count: 10, gap: 0.8, leak: 1 },
  runner: { name: 'Runners', hp: 0.7, speed: 3.0, armor: 0, count: 10, gap: 0.7, leak: 1 },
  shell: { name: 'Shellbacks', hp: 1.15, speed: 1.45, armor: 4, count: 10, gap: 0.9, leak: 1 },
  bat: { name: 'Flyers', hp: 0.8, speed: 1.7, armor: 0, count: 10, gap: 0.8, leak: 1, flying: true },
  slime: { name: 'Slime swarm', hp: 0.45, speed: 2.1, armor: 0, count: 18, gap: 0.45, leak: 1 },
  golem: { name: 'Boss', hp: 16, speed: 1.15, armor: 6, count: 1, gap: 1, leak: 5, boss: true },
};

const PATTERN = ['crawler', 'runner', 'shell', 'bat', 'slime', 'crawler', 'shell', 'runner', 'bat', 'golem'];

export function waveHp(n) {
  return 20 * Math.pow(1.15, n - 1) * (1 + 0.2 * n);
}

// Returns the spawn list for wave n: [{kind, hp, armor, speed, delay}]
export function buildWave(n) {
  const kind = PATTERN[(n - 1) % PATTERN.length];
  const k = ENEMY_KINDS[kind];
  const base = waveHp(n);
  const armor = Math.floor(n / 6) + k.armor;
  const list = [];
  let t = 0;
  if (k.boss) {
    // A boss rides in behind a small escort.
    for (let i = 0; i < 4; i++) {
      list.push({ kind: 'crawler', hp: base * 0.8, armor: Math.floor(n / 6), speed: ENEMY_KINDS.crawler.speed, delay: t, leak: 1 });
      t += 0.8;
    }
    t += 1.5;
    list.push({ kind, hp: base * k.hp * (n >= 30 ? 1.25 : 1), armor, speed: k.speed, delay: t, leak: k.leak, boss: true });
    return { kind, name: k.name, list };
  }
  for (let i = 0; i < k.count; i++) {
    list.push({ kind, hp: base * k.hp, armor, speed: k.speed, delay: t, leak: k.leak, flying: !!k.flying });
    t += k.gap;
  }
  return { kind, name: k.name, list };
}

export function waveName(n) {
  const kind = PATTERN[(n - 1) % PATTERN.length];
  return ENEMY_KINDS[kind].name;
}
export function waveKind(n) { return PATTERN[(n - 1) % PATTERN.length]; }

// WC3-style armor: positive armor reduces damage, negative armor increases it.
export function armorFactor(a) {
  if (a >= 0) return 1 / (1 + 0.06 * a);
  return 2 - Math.pow(0.94, -a);
}
