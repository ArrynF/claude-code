'use strict';
/* Galaxy Explorer — a zoomable galaxy of procedurally rendered worlds connected by routes.
 * No dependencies. Data is saved to localStorage and can be exported/imported as JSON. */

// ============================================================================
// Random numbers & noise
// ============================================================================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randSeed = () => (Math.random() * 2 ** 31) | 0;

function makeNoise(seed) {
  const r = mulberry32(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const v = new Float32Array(256);
  for (let i = 0; i < 256; i++) v[i] = r();
  function n3(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const xf = x - X, yf = y - Y, zf = z - Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf), q = zf * zf * (3 - 2 * zf);
    const A = p[xi] + yi, B = p[xi + 1] + yi;
    const AA = p[A] + zi, AB = p[A + 1] + zi, BA = p[B] + zi, BB = p[B + 1] + zi;
    const x00 = v[p[AA]] + u * (v[p[BA]] - v[p[AA]]);
    const x10 = v[p[AB]] + u * (v[p[BB]] - v[p[AB]]);
    const x01 = v[p[AA + 1]] + u * (v[p[BA + 1]] - v[p[AA + 1]]);
    const x11 = v[p[AB + 1]] + u * (v[p[BB + 1]] - v[p[AB + 1]]);
    const y0 = x00 + w * (x10 - x00), y1 = x01 + w * (x11 - x01);
    return y0 + q * (y1 - y0);
  }
  function fbm(x, y, z, oct) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * n3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  return { n3, fbm };
}

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const stretch = (h, k = 2.4) => clamp((h - 0.5) * k + 0.5);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function grad(stops, t, o) {
  t = clamp(t);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0 || 1);
      o[0] = c0[0] + (c1[0] - c0[0]) * k; o[1] = c0[1] + (c1[1] - c0[1]) * k; o[2] = c0[2] + (c1[2] - c0[2]) * k;
      return o;
    }
  }
  const c = stops[stops.length - 1][1]; o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
  return o;
}
function mixInto(o, c, k) { o[0] += (c[0] - o[0]) * k; o[1] += (c[1] - o[1]) * k; o[2] += (c[2] - o[2]) * k; }

// ============================================================================
// World types: palettes + surface painters
// ============================================================================
const WATER = [[0, [6, 22, 70]], [0.75, [22, 75, 150]], [1, [55, 130, 195]]];
const TERRAN_LAND = [[0, [205, 190, 135]], [0.05, [95, 150, 70]], [0.35, [48, 112, 52]], [0.62, [118, 102, 72]], [0.84, [150, 142, 132]], [1, [246, 246, 250]]];
const JUNGLE_LAND = [[0, [80, 130, 55]], [0.25, [35, 102, 40]], [0.6, [22, 74, 32]], [1, [70, 92, 52]]];
const DESERT = [[0, [110, 60, 30]], [0.35, [185, 112, 55]], [0.65, [225, 170, 100]], [1, [245, 215, 160]]];
const ICE = [[0, [130, 165, 200]], [0.45, [195, 215, 235]], [1, [245, 250, 255]]];
const ROCK = [[0, [22, 16, 16]], [0.5, [55, 42, 38]], [1, [100, 82, 72]]];
const GRAY = [[0, [55, 52, 50]], [0.5, [120, 115, 108]], [1, [185, 180, 172]]];
const CRYSTAL = [[0, [40, 14, 70]], [0.4, [110, 50, 190]], [0.75, [70, 190, 225]], [1, [210, 250, 255]]];
const TOXIC = [[0, [70, 80, 20]], [0.4, [150, 160, 40]], [0.7, [205, 195, 70]], [1, [235, 230, 150]]];
const GAS_PALETTES = [
  [[0, [115, 72, 45]], [0.35, [195, 145, 98]], [0.65, [236, 216, 182]], [1, [168, 108, 68]]],
  [[0, [25, 55, 115]], [0.5, [85, 148, 200]], [1, [205, 232, 246]]],
  [[0, [62, 36, 96]], [0.5, [158, 100, 180]], [1, [232, 192, 222]]],
  [[0, [145, 115, 58]], [0.5, [222, 202, 140]], [1, [252, 242, 212]]],
  [[0, [120, 40, 40]], [0.5, [215, 120, 80]], [1, [250, 210, 170]]],
];

function landSea(o, h, d, lat, sea, land, iceLat) {
  if (h < sea) grad(WATER, h / sea, o);
  else grad(land, (h - sea) / (1 - sea), o);
  const v = 0.9 + d * 0.2; o[0] *= v; o[1] *= v; o[2] *= v;
  if (iceLat && Math.abs(lat) > iceLat - (d - 0.5) * 0.18) mixInto(o, [236, 243, 252], 0.92);
}

const TYPES = {
  'Terran':    { color: '#5fb0ff', atmo: [120, 180, 255, 0.9], clouds: 0.85, cloudColor: [255, 255, 255], freq: 1.6, size: [10, 14], climate: 'Temperate', temp: [4, 24], grav: [0.8, 1.25],
                 paint(o, h, d, lat) { landSea(o, h, d, lat, 0.52, TERRAN_LAND, 0.86); } },
  'Ocean':     { color: '#3d7dff', atmo: [100, 160, 255, 1], clouds: 0.9, cloudColor: [255, 255, 255], freq: 1.4, size: [10, 15], climate: 'Maritime', temp: [8, 28], grav: [0.7, 1.3],
                 paint(o, h, d, lat) { landSea(o, h, d, lat, 0.7, TERRAN_LAND, 0.92); } },
  'Jungle':    { color: '#47c46b', atmo: [140, 220, 160, 0.8], clouds: 0.75, cloudColor: [240, 250, 245], freq: 1.9, size: [9, 13], climate: 'Humid', temp: [24, 38], grav: [0.9, 1.4],
                 paint(o, h, d, lat) { landSea(o, h, d, lat, 0.34, JUNGLE_LAND, 0); } },
  'Desert':    { color: '#e0a35a', atmo: [240, 190, 130, 0.6], clouds: 0.18, cloudColor: [235, 200, 150], freq: 1.5, size: [8, 13], climate: 'Arid', temp: [30, 62], grav: [0.5, 1.1],
                 paint(o, h, d, lat) { grad(DESERT, h * 0.72 + d * 0.28, o); const s = 0.93 + 0.07 * Math.sin(d * 46 + lat * 10); o[0] *= s; o[1] *= s; o[2] *= s; if (Math.abs(lat) > 0.95) mixInto(o, [240, 230, 215], 0.7); } },
  'Ice':       { color: '#bfe4ff', atmo: [190, 225, 255, 0.7], clouds: 0.3, cloudColor: [250, 252, 255], freq: 1.8, size: [8, 13], climate: 'Frozen', temp: [-120, -25], grav: [0.4, 1.0],
                 paint(o, h, d) { grad(ICE, h, o); if (Math.abs(d - 0.5) < 0.018) mixInto(o, [70, 120, 175], 0.8); } },
  'Volcanic':  { color: '#ff6a3a', atmo: [255, 120, 70, 0.6], clouds: 0.35, cloudColor: [80, 70, 70], freq: 2.0, size: [8, 12], climate: 'Scorching', temp: [180, 620], grav: [0.8, 1.6],
                 paint(o, h, d) {
                   grad(ROCK, h * 0.8 + d * 0.2, o);
                   const ridge = 1 - Math.abs(d * 2 - 1);
                   let lava = Math.max(smooth(0.9, 0.99, ridge), smooth(0.24, 0.12, h));
                   if (lava > 0) { mixInto(o, [255, 110 + 80 * lava, 25], lava); o[3] = lava * 255; }
                 } },
  'Gas Giant': { color: '#d9b38c', atmo: [240, 210, 170, 0.7], clouds: 0, freq: 1.2, stretchY: 5, size: [17, 24], climate: 'Storm-wracked', temp: [-160, -90], grav: [2.0, 3.0], gas: true,
                 paint(o, h, d, lat, cr, pal) { const t = Math.sin(lat * pal.bands * Math.PI + (h - 0.5) * 4) * 0.5 + 0.5; grad(pal.stops, t * 0.78 + d * 0.22, o); } },
  'Barren':    { color: '#a7a19a', atmo: [200, 200, 200, 0.12], clouds: 0, freq: 2.2, size: [6, 11], climate: 'Airless', temp: [-170, 120], grav: [0.15, 0.7], craters: 46,
                 paint(o, h, d, lat, cr) { grad(GRAY, h * 0.55 + d * 0.45, o); const k = 1 + cr * 0.4; o[0] *= k; o[1] *= k; o[2] *= k; } },
  'Crystal':   { color: '#b07bff', atmo: [190, 140, 255, 0.85], clouds: 0, freq: 2.0, size: [7, 11], climate: 'Resonant', temp: [-60, 10], grav: [0.6, 1.2],
                 paint(o, h, d) { const q = Math.floor(h * 7) / 7; grad(CRYSTAL, q * 0.72 + d * 0.28, o); if (h > 0.74) o[3] = (h - 0.74) / 0.26 * 210; } },
  'Toxic':     { color: '#c6d24a', atmo: [210, 220, 90, 0.9], clouds: 0.95, cloudColor: [215, 205, 115], freq: 1.6, size: [9, 13], climate: 'Caustic', temp: [60, 240], grav: [0.8, 1.5],
                 paint(o, h, d, lat) { const t = Math.sin(lat * 7 + (h - 0.5) * 5) * 0.5 + 0.5; grad(TOXIC, t * 0.55 + h * 0.45, o); } },
};
const TYPE_NAMES = Object.keys(TYPES);
const ROUTE_KINDS = {
  hyperlane: { label: 'Hyperlane', color: [110, 168, 255], icon: '━' },
  trade:     { label: 'Trade route', color: [255, 200, 90], icon: '┅' },
  wormhole:  { label: 'Wormhole', color: [190, 120, 255], icon: '◌' },
};

// ============================================================================
// Procedural textures & sphere rendering
// ============================================================================
const texCache = new Map();   // key -> {tex, cl, TW, TH}
const thumbCache = new Map(); // key -> canvas

function genCraters(seed, count) {
  const r = mulberry32(seed ^ 0xC0FFEE); const list = [];
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const rad = 0.03 + Math.pow(r(), 3) * 0.28;
    list.push([s * Math.cos(th), u, s * Math.sin(th), rad, Math.cos(rad * 1.25)]);
  }
  return list;
}

function getTexture(w, TW) {
  const key = `${w.type}:${w.seed}:${TW}`;
  let t = texCache.get(key);
  if (t) return t;
  const TH = TW / 2;
  const def = TYPES[w.type] || TYPES.Barren;
  const N = makeNoise(w.seed), N2 = makeNoise(w.seed ^ 0x9e3779b9), N3 = makeNoise(w.seed ^ 0x51ed27);
  const tex = new Uint8ClampedArray(TW * TH * 4), cl = new Uint8Array(TW * TH);
  const craters = def.craters ? genCraters(w.seed, def.craters) : null;
  const pr = mulberry32(w.seed ^ 0xABCD);
  const pal = def.gas ? { stops: GAS_PALETTES[(pr() * GAS_PALETTES.length) | 0], bands: 3 + pr() * 5 } : null;
  const f = def.freq || 1.8, sy = def.stretchY || 1, oct = TW >= 256 ? 6 : 4;
  const o = [0, 0, 0, 0];
  for (let j = 0; j < TH; j++) {
    const lat = ((j + 0.5) / TH) * Math.PI - Math.PI / 2;
    const sl = Math.sin(lat), clat = Math.cos(lat);
    for (let i = 0; i < TW; i++) {
      const lon = ((i + 0.5) / TW) * Math.PI * 2;
      const x = clat * Math.cos(lon), y = sl, z = clat * Math.sin(lon);
      const h = stretch(N.fbm(x * f + 11, y * f * sy + 11, z * f + 11, oct));
      const d = stretch(N2.fbm(x * f * 2.3 + 3, y * f * 2.3 * sy + 3, z * f * 2.3 + 3, oct - 1));
      let cr = 0;
      if (craters) {
        for (let c = 0; c < craters.length; c++) {
          const k = craters[c], dot = x * k[0] + y * k[1] + z * k[2];
          if (dot > k[4]) {
            const a = Math.acos(Math.min(1, dot)) / k[3];
            cr += a < 1 ? -(1 - a * a) * 0.7 + smooth(0.75, 1, a) * 0.6 : (1.25 - a) * 1.6;
          }
        }
        cr = clamp(cr, -1, 1);
      }
      o[3] = 0;
      def.paint(o, h, d, sl, cr, pal);
      const idx = (j * TW + i) * 4;
      tex[idx] = o[0]; tex[idx + 1] = o[1]; tex[idx + 2] = o[2]; tex[idx + 3] = o[3];
      if (def.clouds) {
        const c = stretch(N3.fbm(x * 2.4 + 40, y * 3.4 + 40, z * 2.4 + 40, oct - 1), 2.2);
        cl[j * TW + i] = smooth(0.52, 0.8, c) * def.clouds * 255;
      }
    }
  }
  t = { tex, cl, TW, TH };
  texCache.set(key, t);
  // Keep only the most recent high-res textures (~2.5 MB each).
  if (TW >= 512) {
    const big = [...texCache.keys()].filter(k => k.endsWith(':' + TW));
    while (big.length > 10) texCache.delete(big.shift());
  }
  return t;
}

const sphereMaps = new Map();
function getSphereMap(S) {
  let m = sphereMaps.get(S);
  if (m) return m;
  const n = S * S;
  const mu = new Float32Array(n), mv = new Float32Array(n), sh = new Float32Array(n), rim = new Float32Array(n), al = new Float32Array(n);
  let L = [-0.58, -0.38, 0.72]; const ll = Math.hypot(...L); L = L.map(v => v / ll);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const k = py * S + px;
      const nx = ((px + 0.5) / S) * 2 - 1, ny = ((py + 0.5) / S) * 2 - 1;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      const r = Math.sqrt(r2), nz = Math.sqrt(1 - r2);
      al[k] = clamp((1 - r) * S * 0.5);
      mu[k] = Math.atan2(nx, nz) / (Math.PI * 2) + 0.5;
      mv[k] = Math.asin(ny) / Math.PI + 0.5;
      const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      sh[k] = 0.035 + 0.965 * Math.pow(lam, 0.85);
      rim[k] = Math.pow(1 - nz, 2.2);
    }
  }
  m = { S, mu, mv, sh, rim, al };
  sphereMaps.set(S, m);
  return m;
}

function renderSphere(ctx2d, img, map, T, w, rot, cloudRot) {
  const { mu, mv, sh, rim, al } = map, { tex, cl, TW, TH } = T;
  const def = TYPES[w.type] || TYPES.Barren;
  const cc = def.cloudColor || [255, 255, 255], hasC = !!def.clouds;
  const [ar, ag, ab, as] = def.atmo;
  const d = img.data, n = mu.length;
  for (let k = 0; k < n; k++) {
    const o = k * 4;
    const a = al[k];
    if (a === 0) { d[o + 3] = 0; continue; }
    let row = (mv[k] * TH) | 0; if (row >= TH) row = TH - 1;
    let uu = mu[k] + rot; uu -= Math.floor(uu);
    const ti = row * TW + ((uu * TW) | 0);
    let r = tex[ti * 4], g = tex[ti * 4 + 1], b = tex[ti * 4 + 2], e = tex[ti * 4 + 3];
    if (hasC) {
      let uc = mu[k] + cloudRot; uc -= Math.floor(uc);
      const ca = cl[row * TW + ((uc * TW) | 0)] / 255;
      if (ca > 0) { r += (cc[0] - r) * ca; g += (cc[1] - g) * ca; b += (cc[2] - b) * ca; e *= 1 - ca; }
    }
    const s = sh[k], rm = rim[k] * as * (0.25 + s);
    const em = e * (1 - s * 0.6) / 255;
    d[o] = r * s + 255 * em + ar * rm;
    d[o + 1] = g * s + 120 * em + ag * rm;
    d[o + 2] = b * s + 40 * em + ab * rm;
    d[o + 3] = a * 255;
  }
  ctx2d.putImageData(img, 0, 0);
}

function getThumb(w) {
  const key = `${w.type}:${w.seed}`;
  let c = thumbCache.get(key);
  if (c) return c;
  const S = 72;
  c = document.createElement('canvas'); c.width = c.height = S;
  const cx = c.getContext('2d');
  const img = cx.createImageData(S, S);
  renderSphere(cx, img, getSphereMap(S), getTexture(w, 128), w, (w.seed % 1000) / 1000, 0.3);
  thumbCache.set(key, c);
  return c;
}

function drawRings(ctx, x, y, R, front, seed) {
  const r = mulberry32(seed ^ 0x777);
  const tilt = 0.28, hue = r();
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.32); ctx.scale(1, tilt);
  const start = front ? 0 : Math.PI, end = front ? Math.PI : Math.PI * 2;
  for (let i = 0; i < 26; i++) {
    const rr = R * (1.35 + i * 0.035);
    const a = 0.12 + r() * 0.35;
    const c = hue < 0.5 ? `rgba(${220 - i * 2},${200 - i * 3},${170 - i * 3},${a})` : `rgba(${180 + i},${200},${230},${a})`;
    ctx.strokeStyle = c; ctx.lineWidth = R * 0.035 / tilt * 0.6;
    ctx.beginPath(); ctx.arc(0, 0, rr, start, end); ctx.stroke();
  }
  ctx.restore();
}

// ============================================================================
// Galaxy generation
// ============================================================================
const SYL = ['ka', 'ri', 'zan', 'tho', 'vel', 'mar', 'os', 'ae', 'lu', 'qua', 'dor', 'phe', 'ny', 'xi', 'sol', 'ter', 'ion', 'cy', 'bra', 'vex', 'or', 'eth', 'ul', 'sar', 'mi', 'nox', 'rha', 'tal', 'ven', 'zu', 'kel', 'ira', 'an', 'go', 'ser', 'thal'];
const SUFFIX = ['', '', '', '', ' Prime', ' II', ' IV', ' VII', ' Minor', ' Major', ' Secundus', "'s Reach", ' Tertius'];
const FACTIONS = ['Solar Concord', 'Free Traders Guild', 'Veyran Hegemony', 'Order of the Lattice', 'Kesh Collective', 'Independent', 'Unclaimed'];
const ADJ = ['Glass', 'Silent', 'Crimson', 'Sunken', 'Shattered', 'Singing', 'Hollow', 'Gilded', 'Drowned', 'Burning', 'Pale', 'Iron', 'Whispering', 'Obsidian'];
const RESOURCES = {
  'Terran': ['Fresh water', 'Arable land', 'Timber', 'Rare earths', 'Livestock', 'Iron ore'],
  'Ocean': ['Deuterium', 'Kelp biomass', 'Pearlescent coral', 'Fresh water', 'Bioluminescent algae'],
  'Jungle': ['Medicinal flora', 'Hardwood', 'Spice resin', 'Exotic fauna', 'Bio-polymers'],
  'Desert': ['Silicates', 'Solar energy', 'Glass sand', 'Titanium', 'Ancient relics'],
  'Ice': ['Water ice', 'Frozen methane', 'Cryo-crystals', 'Helium-3', 'Preserved fossils'],
  'Volcanic': ['Obsidian', 'Sulfur', 'Geothermal energy', 'Platinum', 'Heavy metals'],
  'Gas Giant': ['Helium-3', 'Hydrogen', 'Exotic gases', 'Metallic hydrogen', 'Atmospheric plankton'],
  'Barren': ['Nickel-iron', 'Regolith', 'Cobalt', 'Helium-3', 'Platinum'],
  'Crystal': ['Resonance crystals', 'Quartz lattices', 'Psionic shards', 'Dilithium', 'Prismatic glass'],
  'Toxic': ['Chlorine', 'Ammonia', 'Industrial acids', 'Xenobacteria', 'Sulfuric compounds'],
};
const DESC = {
  'Terran': ['{n} is a temperate world of drifting continents, deep blue seas and long, gentle seasons.', 'Green and blue, {n} is the kind of world colonists dream about — and fight over.'],
  'Ocean': ['{n} is almost entirely covered by a single planetary ocean, kilometres deep and teeming with life.', 'Floating cities ride the endless swells of {n}, tethered to the abyss below.'],
  'Jungle': ['A canopy hundreds of metres tall shrouds {n}, hiding rivers, ruins and things best left alone.', '{n} is a humid, overgrown world where the forest reclaims anything left standing for long.'],
  'Desert': ['Wind-carved dunes roll across {n} beneath a merciless sun.', '{n} is a parched world of red canyons and glassy salt flats, its oceans long since boiled away.'],
  'Ice': ['{n} is locked beneath glaciers older than most stars in the sector.', 'Beneath the frozen crust of {n}, a liquid ocean may still be churning in the dark.'],
  'Volcanic': ['Rivers of lava split the obsidian plains of {n}, and the sky glows orange at night.', '{n} is tidally tortured by its neighbours, its crust erupting without pause.'],
  'Gas Giant': ['{n} is a banded giant of hydrogen and helium, its storms large enough to swallow lesser worlds.', 'Cloud-skimming refineries drift through the upper atmosphere of {n}.'],
  'Barren': ['{n} is an airless rock, scarred by billions of years of impacts.', 'Little more than a cratered husk, {n} is valued only for what lies beneath its dust.'],
  'Crystal': ['Vast crystalline formations cover {n}, humming softly when starlight strikes them.', 'The surface of {n} refracts light into shifting aurorae; scholars still argue over whether the crystals grow.'],
  'Toxic': ['Thick, caustic clouds hide the surface of {n} from view.', '{n} is wrapped in acid rain and yellow haze — deadly, but rich in industrial chemistry.'],
};
const FLAVOR = [
  'Orbital shipyards hang above its equator like a string of pearls.',
  'Ancient precursor ruins dot its surface, still not fully understood.',
  'Smugglers whisper of hidden landing fields in its remote regions.',
  'Pilgrims travel here to witness the auroras that roll across the poles.',
  'It is a key waypoint for convoys crossing this arm of the galaxy.',
  'A long-abandoned research station still broadcasts on an unknown frequency.',
  'Local legend says the first explorers never left.',
  '',
];
const POI_T = [
  ['The {a} Spire', 'a towering structure of unknown origin'],
  ['Ruins of Old {s}', 'remains of a precursor city'],
  ['Port {s}', 'the main spaceport and trade hub'],
  ['{s} Observatory', 'deep-space listening post'],
  ['The {a} Basin', 'a vast impact crater'],
  ['{s} Deep Mines', 'mining complex reaching kilometres down'],
  ['{a} Citadel', 'fortified seat of local government'],
  ['The {a} Expanse', 'uncharted wilderness'],
  ['{s} Orbital Ring', 'habitat ring circling the planet'],
  ['{a} Archive', 'library holding pre-collapse records'],
];

function syllName(R, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += SYL[(R() * SYL.length) | 0];
  return s[0].toUpperCase() + s.slice(1);
}

function makeWorld(R, x, y, type, name) {
  const def = TYPES[type];
  const range = (a, b) => a + R() * (b - a);
  const pick = a => a[(R() * a.length) | 0];
  const habit = { Terran: 1, Ocean: 0.9, Jungle: 0.8, Desert: 0.4, Ice: 0.3, 'Gas Giant': 0.2, Toxic: 0.1, Volcanic: 0.1, Barren: 0.15, Crystal: 0.2 }[type];
  let pop = 0;
  if (R() < habit + 0.2) pop = Math.round(Math.pow(R(), 2) * habit * 1.2e10 + R() * 5e6);
  const res = [...RESOURCES[type]].sort(() => R() - 0.5).slice(0, 2 + ((R() * 3) | 0));
  const poi = [...POI_T].sort(() => R() - 0.5).slice(0, 2 + ((R() * 3) | 0))
    .map(([t, d]) => t.replace('{a}', pick(ADJ)).replace('{s}', syllName(R, 2)) + ' — ' + d);
  return {
    id: 'w' + Math.floor(R() * 1e9).toString(36),
    name, type, x: Math.round(x), y: Math.round(y),
    size: Math.round(range(def.size[0], def.size[1])),
    seed: (R() * 2 ** 31) | 0,
    faction: pop ? pick(FACTIONS.slice(0, 6)) : 'Unclaimed',
    population: pop,
    climate: def.climate,
    temperature: Math.round(range(def.temp[0], def.temp[1])),
    gravity: +range(def.grav[0], def.grav[1]).toFixed(2),
    dayLength: +range(type === 'Gas Giant' ? 8 : 14, type === 'Gas Giant' ? 16 : 60).toFixed(1),
    moons: type === 'Gas Giant' ? 2 + ((R() * 5) | 0) : (R() < 0.55 ? (R() * 3) | 0 : 0),
    rings: type === 'Gas Giant' ? R() < 0.6 : R() < 0.07,
    description: pick(DESC[type]).replace('{n}', name) + ' ' + pick(FLAVOR),
    resources: res,
    poi,
  };
}

function segIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  if (a === c || a === d || b === c || b === d) return false;
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function generateGalaxy(seed) {
  const R = mulberry32(seed);
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  const weights = [['Terran', 3], ['Ocean', 2], ['Desert', 3], ['Ice', 3], ['Volcanic', 2], ['Gas Giant', 4], ['Jungle', 2], ['Barren', 4], ['Crystal', 1.2], ['Toxic', 2]];
  const total = weights.reduce((s, w) => s + w[1], 0);
  const pickType = () => { let r = R() * total; for (const [t, w] of weights) { if ((r -= w) <= 0) return t; } return 'Barren'; };
  const arms = 3, count = 36 + ((R() * 10) | 0);
  const worlds = [], names = new Set();
  for (let tries = 0; worlds.length < count && tries < 6000; tries++) {
    const arm = tries % arms;
    const dist = 170 + Math.pow(R(), 0.85) * 1150;
    const ang = (arm * Math.PI * 2) / arms + dist * 0.0042 + gauss() * 0.32;
    const x = Math.cos(ang) * dist, y = Math.sin(ang) * dist;
    if (worlds.some(w => Math.hypot(w.x - x, w.y - y) < 90)) continue;
    let name;
    do { name = syllName(R, 2 + (R() < 0.35 ? 1 : 0)) + SUFFIX[(R() * SUFFIX.length) | 0]; } while (names.has(name));
    names.add(name);
    worlds.push(makeWorld(R, x, y, pickType(), name));
  }
  // Minimum spanning tree guarantees everything is reachable.
  const routes = [], dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const inTree = new Set([0]);
  while (inTree.size < worlds.length) {
    let best = null;
    for (const i of inTree) for (let j = 0; j < worlds.length; j++) {
      if (inTree.has(j)) continue;
      const d = dist(worlds[i], worlds[j]);
      if (!best || d < best[2]) best = [i, j, d];
    }
    inTree.add(best[1]);
    routes.push(mkRoute(worlds[best[0]], worlds[best[1]], R() < 0.3 ? 'trade' : 'hyperlane'));
  }
  // Extra lanes for loops / alternate paths, avoiding crossings.
  for (const w of worlds) {
    const near = worlds.filter(o => o !== w).sort((a, b) => dist(w, a) - dist(w, b)).slice(0, 4);
    for (const o of near) {
      if (dist(w, o) > 300 || R() < 0.45) continue;
      if (routes.some(r => (r.a === w.id && r.b === o.id) || (r.a === o.id && r.b === w.id))) continue;
      const crosses = routes.some(r => r.kind !== 'wormhole' && segIntersect(w, o, byIdIn(worlds, r.a), byIdIn(worlds, r.b)));
      if (!crosses) routes.push(mkRoute(w, o, R() < 0.25 ? 'trade' : 'hyperlane'));
    }
  }
  // A few long-range wormholes.
  for (let i = 0, made = 0; i < 200 && made < 3; i++) {
    const a = worlds[(R() * worlds.length) | 0], b = worlds[(R() * worlds.length) | 0];
    if (a !== b && dist(a, b) > 900) { routes.push(mkRoute(a, b, 'wormhole')); made++; }
  }
  const gname = syllName(R, 2) + ' ' + ['Spiral', 'Expanse', 'Cluster', 'Galaxy', 'Nebula'][(R() * 5) | 0];
  return { version: 1, name: gname, seed, worlds, routes };
}
function byIdIn(list, id) { return list.find(w => w.id === id); }
function mkRoute(a, b, kind) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return { id: 'r' + Math.floor(Math.random() * 1e9).toString(36), a: a.id, b: b.id, kind, days: kind === 'wormhole' ? 1 : Math.max(1, Math.round(d / (kind === 'trade' ? 28 : 34))) };
}

// ============================================================================
// State & persistence
// ============================================================================
const STORE_KEY = 'galaxy-explorer:v1';
let G = null;
const state = {
  mode: 'explore', view: 'galaxy',
  cam: { x: 0, y: 0, zoom: 0.4 }, tween: null,
  hover: null, selected: null, selectedRoute: null, connectFrom: null,
  path: null, focusPulse: null,
  detail: null, detailEditing: false, prevCam: null,
};
const worldById = id => G.worlds.find(w => w.id === id);
const routesOf = w => G.routes.filter(r => r.a === w.id || r.b === w.id);
const otherEnd = (r, w) => worldById(r.a === w.id ? r.b : r.a);

function normalize(g) {
  if (!g || !Array.isArray(g.worlds) || !Array.isArray(g.routes)) throw new Error('Not a galaxy file');
  const R = mulberry32(randSeed());
  g.name = String(g.name || 'Unnamed Galaxy');
  g.seed = g.seed | 0 || randSeed();
  g.worlds = g.worlds.map(w => {
    const type = TYPES[w.type] ? w.type : 'Barren';
    const base = makeWorld(R, +w.x || 0, +w.y || 0, type, String(w.name || 'Unnamed'));
    return { ...base, ...w, type, resources: Array.isArray(w.resources) ? w.resources : base.resources, poi: Array.isArray(w.poi) ? w.poi : base.poi };
  });
  const ids = new Set(g.worlds.map(w => w.id));
  g.routes = g.routes.filter(r => ids.has(r.a) && ids.has(r.b) && r.a !== r.b)
    .map(r => ({ id: r.id || 'r' + Math.random().toString(36).slice(2, 9), a: r.a, b: r.b, kind: ROUTE_KINDS[r.kind] ? r.kind : 'hyperlane', days: Math.max(1, +r.days || 1) }));
  return g;
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(G)); } catch (e) { /* storage unavailable */ } }, 300);
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) { /* ignore */ }
  return generateGalaxy(20261119);
}

// ============================================================================
// Canvas setup
// ============================================================================
const canvas = document.getElementById('galaxy');
const ctx = canvas.getContext('2d');
const pcanvas = document.getElementById('planetCanvas');
const pctx = pcanvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const r = pcanvas.getBoundingClientRect();
  pcanvas.width = Math.max(1, r.width * DPR); pcanvas.height = Math.max(1, r.height * DPR);
}
addEventListener('resize', resize);

const worldR = w => w.size * (state.cam.zoom < 1 ? Math.pow(state.cam.zoom, 0.6) : state.cam.zoom);
const toScreen = (x, y) => [(x - state.cam.x) * state.cam.zoom + W / 2, (y - state.cam.y) * state.cam.zoom + H / 2];
const toWorld = (sx, sy) => [(sx - W / 2) / state.cam.zoom + state.cam.x, (sy - H / 2) / state.cam.zoom + state.cam.y];

// Starfield (screen space, parallax layers)
const starLayers = [0.04, 0.1, 0.2].map((par, li) => {
  const R = mulberry32(99 + li), T = 1600;
  return { par, T, stars: Array.from({ length: 260 }, () => [R() * T, R() * T, (0.4 + R() * 0.9) * (li + 1) * 0.45, 0.3 + R() * 0.7, R()]) };
});
function drawStars(c, w, h, camx, camy, zoom, t) {
  for (const L of starLayers) {
    const ox = (((-camx * zoom * L.par) % L.T) + L.T) % L.T, oy = (((-camy * zoom * L.par) % L.T) + L.T) % L.T;
    for (const [sx, sy, r, a, tw] of L.stars) {
      const alpha = a * (0.75 + 0.25 * Math.sin(t * 0.002 + tw * 50));
      c.fillStyle = tw < 0.15 ? `rgba(255,210,170,${alpha})` : tw > 0.85 ? `rgba(170,200,255,${alpha})` : `rgba(255,255,255,${alpha})`;
      for (let x = (sx + ox) % L.T - L.T; x < w; x += L.T) {
        if (x < -2) continue;
        for (let y = (sy + oy) % L.T - L.T; y < h; y += L.T) { if (y >= -2) c.fillRect(x, y, r, r); }
      }
    }
  }
}

// Galaxy dust: pre-rendered once into an offscreen canvas in world coordinates.
let dust = null;
const DUST_B = 1700, DUST_SCALE = 0.5;
function buildDust() {
  const size = DUST_B * 2 * DUST_SCALE;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const d = c.getContext('2d');
  const sprite = (rgb) => {
    const s = document.createElement('canvas'); s.width = s.height = 64;
    const sc = s.getContext('2d'), g = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(1, `rgba(${rgb},0)`);
    sc.fillStyle = g; sc.fillRect(0, 0, 64, 64); return s;
  };
  const sprites = [sprite('90,120,255'), sprite('160,90,255'), sprite('255,120,190'), sprite('120,200,255'), sprite('255,220,180')];
  const R = mulberry32(G.seed);
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  const cx = size / 2;
  d.globalCompositeOperation = 'lighter';
  const core = d.createRadialGradient(cx, cx, 0, cx, cx, 520 * DUST_SCALE);
  core.addColorStop(0, 'rgba(255,230,200,0.55)'); core.addColorStop(0.3, 'rgba(255,170,150,0.18)'); core.addColorStop(1, 'rgba(120,80,200,0)');
  d.fillStyle = core; d.fillRect(0, 0, size, size);
  for (let i = 0; i < 4200; i++) {
    const arm = i % 3;
    const dist = Math.pow(R(), 0.8) * 1450;
    const ang = (arm * Math.PI * 2) / 3 + dist * 0.0042 + gauss() * (0.22 + 0.25 * (1 - dist / 1450));
    const x = cx + Math.cos(ang) * dist * DUST_SCALE, y = cx + Math.sin(ang) * dist * DUST_SCALE;
    const sp = dist < 300 ? sprites[4] : sprites[(R() * 4) | 0];
    const s = (12 + R() * 60) * DUST_SCALE;
    d.globalAlpha = 0.025 + R() * 0.06;
    d.drawImage(sp, x - s / 2, y - s / 2, s, s);
  }
  d.globalAlpha = 1;
  for (let i = 0; i < 2600; i++) {
    const arm = i % 3, dist = Math.pow(R(), 0.7) * 1500;
    const ang = (arm * Math.PI * 2) / 3 + dist * 0.0042 + gauss() * 0.45;
    d.fillStyle = `rgba(255,255,255,${0.2 + R() * 0.6})`;
    const s = R() < 0.1 ? 1.6 : 0.8;
    d.fillRect(cx + Math.cos(ang) * dist * DUST_SCALE, cx + Math.sin(ang) * dist * DUST_SCALE, s, s);
  }
  dust = c;
}

// ============================================================================
// Galaxy rendering
// ============================================================================
function routeCurve(r) {
  const a = worldById(r.a), b = worldById(r.b);
  const [ax, ay] = toScreen(a.x, a.y), [bx, by] = toScreen(b.x, b.y);
  let mx = (ax + bx) / 2, my = (ay + by) / 2;
  if (r.kind === 'wormhole') { const dx = bx - ax, dy = by - ay; mx += -dy * 0.18; my += dx * 0.18; }
  return { ax, ay, bx, by, mx, my, a, b };
}
function qPoint(c, t) {
  const u = 1 - t;
  return [u * u * c.ax + 2 * u * t * c.mx + t * t * c.bx, u * u * c.ay + 2 * u * t * c.my + t * t * c.by];
}

function drawGalaxy(t) {
  const { cam } = state, z = cam.zoom;
  ctx.fillStyle = '#04050c'; ctx.fillRect(0, 0, W, H);
  drawStars(ctx, W, H, cam.x, cam.y, z, t);
  if (dust) {
    const [dx, dy] = toScreen(-DUST_B, -DUST_B);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(dust, dx, dy, DUST_B * 2 * z, DUST_B * 2 * z);
    ctx.globalAlpha = 1;
  }

  const pathRoutes = state.path ? state.path.routes : null;
  // Routes
  for (const r of G.routes) {
    const c = routeCurve(r), k = ROUTE_KINDS[r.kind];
    const onPath = pathRoutes && pathRoutes.has(r.id);
    const sel = state.selectedRoute === r.id;
    const hl = onPath || sel || (state.hover && (r.a === state.hover.id || r.b === state.hover.id));
    const dim = pathRoutes && !onPath ? 0.35 : 1;
    const [cr, cg, cb] = onPath ? [130, 255, 210] : k.color;
    ctx.lineCap = 'round';
    if (hl) {
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.22)`; ctx.lineWidth = onPath ? 9 : 6;
      ctx.beginPath(); ctx.moveTo(c.ax, c.ay); ctx.quadraticCurveTo(c.mx, c.my, c.bx, c.by); ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(hl ? 0.95 : 0.5) * dim})`;
    ctx.lineWidth = onPath ? 2.6 : hl ? 2 : 1.3;
    if (r.kind === 'wormhole') { ctx.setLineDash([7, 6]); ctx.lineDashOffset = -t * 0.03; }
    else if (r.kind === 'trade') { ctx.setLineDash([2, 5]); ctx.lineDashOffset = -t * 0.015; }
    ctx.beginPath(); ctx.moveTo(c.ax, c.ay); ctx.quadraticCurveTo(c.mx, c.my, c.bx, c.by); ctx.stroke();
    ctx.setLineDash([]);
    if (onPath) {
      // travelling pulses along the planned path
      const dir = state.path.dir.get(r.id);
      for (let i = 0; i < 3; i++) {
        let p = ((t * 0.00035 + i / 3) % 1); if (dir < 0) p = 1 - p;
        const [px, py] = qPoint(c, p);
        ctx.fillStyle = 'rgba(200,255,235,0.95)';
        ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    if ((z > 1.1 || hl) && r.kind !== 'wormhole' || (hl && r.kind === 'wormhole')) {
      const [lx, ly] = qPoint(c, 0.5);
      if (z > 1.1 || hl) {
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.85 * dim})`;
        ctx.fillText(`${r.days}d`, lx, ly - 5);
      }
    }
  }
  // Connect-mode rubber band
  if (state.connectFrom && pointer.last) {
    const [ax, ay] = toScreen(state.connectFrom.x, state.connectFrom.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(pointer.last[0], pointer.last[1]); ctx.stroke(); ctx.setLineDash([]);
  }

  // Worlds
  const pathWorlds = state.path ? new Set(state.path.worlds) : null;
  for (const w of G.worlds) {
    const [sx, sy] = toScreen(w.x, w.y);
    const r = worldR(w);
    if (sx < -r * 4 || sy < -r * 4 || sx > W + r * 4 || sy > H + r * 4) continue;
    const def = TYPES[w.type];
    const dim = pathWorlds && !pathWorlds.has(w.id) ? 0.45 : 1;
    const gl = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 2.6);
    gl.addColorStop(0, hexA(def.color, 0.35 * dim)); gl.addColorStop(1, hexA(def.color, 0));
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = dim;
    if (w.rings) drawRings(ctx, sx, sy, r, false, w.seed);
    ctx.drawImage(getThumb(w), sx - r, sy - r, r * 2, r * 2);
    if (w.rings) drawRings(ctx, sx, sy, r, true, w.seed);
    ctx.globalAlpha = 1;

    const isSel = state.selected === w || state.connectFrom === w;
    const isHover = state.hover === w;
    if (isSel || isHover) {
      ctx.strokeStyle = isSel ? 'rgba(255,255,255,0.9)' : 'rgba(180,200,255,0.7)';
      ctx.lineWidth = 1.5; ctx.setLineDash(isSel ? [] : [3, 3]);
      ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (state.focusPulse && state.focusPulse.id === w.id) {
      const age = (t - state.focusPulse.t) / 1600;
      if (age < 1) {
        ctx.strokeStyle = `rgba(255,255,255,${1 - age})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, r + 6 + age * 40, 0, Math.PI * 2); ctx.stroke();
      } else state.focusPulse = null;
    }
    if (z > 0.3 || isSel || isHover || (pathWorlds && pathWorlds.has(w.id))) {
      ctx.font = `${isHover || isSel ? 600 : 500} ${z > 1.5 ? 13 : 12}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(0,0,0,0.6)`; ctx.fillText(w.name, sx + 1, sy + r + 15);
      ctx.fillStyle = `rgba(228,234,255,${0.9 * dim})`; ctx.fillText(w.name, sx, sy + r + 14);
    }
  }
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ============================================================================
// Detail (world) rendering
// ============================================================================
const MOON_TILT = 0.42, DETAIL_TEX = 1024;
let detailImg = null, detailBuf = null, detailRot = 0;
function drawDetail(t, dt) {
  const w = state.detail; if (!w) return;
  const cw = pcanvas.width, ch = pcanvas.height;
  const c = pctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#03040a'; c.fillRect(0, 0, cw, ch);
  drawStars(c, cw, ch, w.x * 3, w.y * 3, 1, t);
  const def = TYPES[w.type];
  const cx = cw / 2, cy = ch / 2;
  const R = Math.min(cw, ch) * (w.rings ? 0.26 : 0.32);
  // nebula wash
  const neb = c.createRadialGradient(cx - R * 0.6, cy - R * 0.4, 0, cx, cy, Math.max(cw, ch) * 0.7);
  neb.addColorStop(0, hexA(def.color, 0.16)); neb.addColorStop(1, hexA(def.color, 0));
  c.fillStyle = neb; c.fillRect(0, 0, cw, ch);
  // atmosphere halo
  const [ar, ag, ab, as] = def.atmo;
  const halo = c.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.25);
  halo.addColorStop(0, `rgba(${ar},${ag},${ab},${0.45 * as})`); halo.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
  c.fillStyle = halo; c.beginPath(); c.arc(cx, cy, R * 1.25, 0, Math.PI * 2); c.fill();

  // moons
  const moons = [];
  const mr = mulberry32(w.seed ^ 0x1234);
  for (let i = 0; i < w.moons; i++) {
    const orbit = R * (1.6 + i * 0.3 + mr() * 0.08), speed = (0.00012 + mr() * 0.00018) / (1 + i * 0.4);
    const a = mr() * Math.PI * 2 + t * speed;
    const size = R * (0.05 + mr() * 0.07);
    const tint = mr();
    moons.push({ x: cx + Math.cos(a) * orbit, y: cy + Math.sin(a) * orbit * MOON_TILT, s: size, front: Math.sin(a) > 0, tint, a, orbit });
  }
  const drawOrbit = m => { c.strokeStyle = 'rgba(180,200,255,0.08)'; c.lineWidth = 1 * DPR; c.save(); c.translate(cx, cy); c.beginPath(); c.ellipse(0, 0, m.orbit, m.orbit * MOON_TILT, 0, 0, Math.PI * 2); c.stroke(); c.restore(); };
  for (const m of moons) drawOrbit(m);
  const drawMoon = m => {
    const g = c.createRadialGradient(m.x - m.s * 0.4, m.y - m.s * 0.4, m.s * 0.1, m.x, m.y, m.s);
    const base = m.tint < 0.5 ? [200, 195, 190] : [210, 180, 150];
    g.addColorStop(0, `rgb(${base})`); g.addColorStop(0.7, `rgb(${base.map(v => v * 0.45 | 0)})`); g.addColorStop(1, 'rgb(15,15,20)');
    c.fillStyle = g; c.beginPath(); c.arc(m.x, m.y, m.s, 0, Math.PI * 2); c.fill();
  };
  for (const m of moons) if (!m.front) drawMoon(m);
  if (w.rings) drawRings(c, cx, cy, R, false, w.seed);

  // planet sphere
  const S = Math.min(560, Math.round(R * 2));
  if (!detailBuf || detailBuf.width !== S) {
    detailBuf = document.createElement('canvas'); detailBuf.width = detailBuf.height = S;
    detailImg = detailBuf.getContext('2d').createImageData(S, S);
  }
  detailRot += dt * 0.000012 * (24 / Math.max(4, w.dayLength)) * 1.6;
  renderSphere(detailBuf.getContext('2d'), detailImg, getSphereMap(S), getTexture(w, DETAIL_TEX), w, detailRot, detailRot * 1.18 + 0.1);
  c.imageSmoothingEnabled = true;
  c.drawImage(detailBuf, cx - R, cy - R, R * 2, R * 2);

  if (w.rings) drawRings(c, cx, cy, R, true, w.seed);
  for (const m of moons) if (m.front) drawMoon(m);
}

// ============================================================================
// Animation loop
// ============================================================================
let lastT = performance.now();
function frame(t) {
  const dt = Math.min(50, t - lastT); lastT = t;
  if (state.tween) {
    const tw = state.tween, k = clamp((t - tw.start) / tw.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    state.cam.x = lerp(tw.from.x, tw.to.x, e);
    state.cam.y = lerp(tw.from.y, tw.to.y, e);
    state.cam.zoom = Math.exp(lerp(Math.log(tw.from.zoom), Math.log(tw.to.zoom), e));
    if (k >= 1) { state.tween = null; tw.done && tw.done(); }
  }
  if (state.view !== 'detail' || state.tween) drawGalaxy(t);
  if (state.view === 'detail') drawDetail(t, dt);
  requestAnimationFrame(frame);
}
function flyTo(x, y, zoom, dur = 800, done) {
  state.tween = { start: performance.now(), dur, from: { ...state.cam }, to: { x, y, zoom: clamp(zoom, 0.12, 8) }, done };
}
function fitView(animate = true) {
  if (!G.worlds.length) { flyTo(0, 0, 0.5); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of G.worlds) { x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y); x1 = Math.max(x1, w.x); y1 = Math.max(y1, w.y); }
  const zoom = Math.min((W - 80) / (x1 - x0 + 160), (H - 160) / (y1 - y0 + 160));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - 20 / zoom;
  if (animate) flyTo(cx, cy, zoom, 700);
  else Object.assign(state.cam, { x: cx, y: cy, zoom: clamp(zoom, 0.12, 8) });
}
function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWorld(sx, sy);
  state.cam.zoom = clamp(state.cam.zoom * factor, 0.12, 8);
  const [nx, ny] = toWorld(sx, sy);
  state.cam.x += wx - nx; state.cam.y += wy - ny;
}

// ============================================================================
// Hit testing & pointer input
// ============================================================================
function worldAt(sx, sy) {
  let best = null, bd = Infinity;
  for (const w of G.worlds) {
    const [x, y] = toScreen(w.x, w.y);
    const d = Math.hypot(x - sx, y - sy), r = Math.max(10, worldR(w) + 4);
    if (d < r && d < bd) { best = w; bd = d; }
  }
  return best;
}
function routeAt(sx, sy) {
  let best = null, bd = 7;
  for (const r of G.routes) {
    const c = routeCurve(r);
    for (let i = 0; i <= 24; i++) {
      const [px, py] = qPoint(c, i / 24);
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = r; }
    }
  }
  return best;
}

const pointer = { map: new Map(), drag: null, pinch: null, last: null };
const tooltip = document.getElementById('tooltip');

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointer.map.set(e.pointerId, [e.clientX, e.clientY]);
  closeMenus();
  state.tween = null;
  if (pointer.map.size === 2) {
    const [a, b] = [...pointer.map.values()];
    pointer.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: state.cam.zoom };
    pointer.drag = null; return;
  }
  const hit = worldAt(e.clientX, e.clientY);
  if (state.mode === 'edit' && hit && !state.connectFrom) pointer.drag = { type: 'world', w: hit, sx: e.clientX, sy: e.clientY, ox: hit.x, oy: hit.y, moved: false };
  else pointer.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: state.cam.x, cy: state.cam.y, moved: false };
});
canvas.addEventListener('pointermove', e => {
  pointer.last = [e.clientX, e.clientY];
  if (pointer.map.has(e.pointerId)) pointer.map.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointer.pinch && pointer.map.size === 2) {
    const [a, b] = [...pointer.map.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pointer.pinch.zoom * d / pointer.pinch.d) / state.cam.zoom);
    return;
  }
  const dr = pointer.drag;
  if (dr) {
    const dx = e.clientX - dr.sx, dy = e.clientY - dr.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) dr.moved = true;
    if (!dr.moved) return;
    if (dr.type === 'pan') { state.cam.x = dr.cx - dx / state.cam.zoom; state.cam.y = dr.cy - dy / state.cam.zoom; canvas.classList.add('grabbing'); }
    else { dr.w.x = Math.round(dr.ox + dx / state.cam.zoom); dr.w.y = Math.round(dr.oy + dy / state.cam.zoom); }
    tooltip.hidden = true;
    return;
  }
  const hit = worldAt(e.clientX, e.clientY);
  state.hover = hit;
  canvas.classList.toggle('pointer', !!hit);
  if (hit && e.pointerType === 'mouse') {
    const links = routesOf(hit).length;
    tooltip.innerHTML = `<b>${esc(hit.name)}</b><span>${hit.type} · ${fmtPop(hit.population)} · ${links} route${links === 1 ? '' : 's'}</span>`;
    tooltip.hidden = false;
    tooltip.style.left = Math.min(e.clientX + 14, W - tooltip.offsetWidth - 8) + 'px';
    tooltip.style.top = (e.clientY + 14) + 'px';
  } else tooltip.hidden = true;
});
function endPointer(e) {
  pointer.map.delete(e.pointerId);
  canvas.classList.remove('grabbing');
  if (pointer.pinch) { if (pointer.map.size < 2) pointer.pinch = null; pointer.drag = null; return; }
  const dr = pointer.drag; pointer.drag = null;
  if (!dr) return;
  if (dr.moved) { if (dr.type === 'world') { save(); refreshEditBar(); } return; }
  if (e.type === 'pointerup') handleClick(e.clientX, e.clientY, e.shiftKey);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!pointer.drag) { state.hover = null; tooltip.hidden = true; } });
canvas.addEventListener('wheel', e => { e.preventDefault(); state.tween = null; zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
canvas.addEventListener('dblclick', e => {
  if (state.mode !== 'edit' || worldAt(e.clientX, e.clientY)) return;
  const [x, y] = toWorld(e.clientX, e.clientY);
  addWorld(x, y);
});

function handleClick(sx, sy, shift) {
  const hit = worldAt(sx, sy);
  if (state.mode === 'explore') { if (hit) openWorld(hit); return; }
  // edit mode
  if (hit) {
    const from = state.connectFrom || (shift && state.selected);
    if (from && from !== hit) { toggleRoute(from, hit); state.connectFrom = null; state.selected = hit; }
    else { state.selected = hit; state.connectFrom = null; }
    state.selectedRoute = null;
  } else {
    const r = routeAt(sx, sy);
    state.selectedRoute = r ? r.id : null;
    state.selected = null; state.connectFrom = null;
  }
  refreshEditBar();
}

// ============================================================================
// Editing operations
// ============================================================================
function uniqueName(base) {
  let n = base, i = 2;
  while (G.worlds.some(w => w.name === n)) n = `${base} ${i++}`;
  return n;
}
function addWorld(x, y) {
  const R = mulberry32(randSeed());
  const type = TYPE_NAMES[(R() * TYPE_NAMES.length) | 0];
  const w = makeWorld(R, x, y, type, uniqueName('New World'));
  w.description = w.description.replace(/New World( \d+)?/g, w.name);
  G.worlds.push(w);
  state.selected = w; state.selectedRoute = null;
  save(); refreshEditBar(); refreshRouteSelects();
  toast(`Added ${w.name}. Open it to edit its details.`);
}
function toggleRoute(a, b) {
  const ex = G.routes.find(r => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id));
  if (ex) { G.routes = G.routes.filter(r => r !== ex); toast(`Removed route ${a.name} ⇄ ${b.name}`); }
  else { G.routes.push(mkRoute(a, b, 'hyperlane')); toast(`Connected ${a.name} ⇄ ${b.name}`); }
  state.path = null; save();
}
function deleteWorld(w) {
  if (!confirm(`Delete ${w.name} and its ${routesOf(w).length} route(s)?`)) return false;
  G.worlds = G.worlds.filter(x => x !== w);
  G.routes = G.routes.filter(r => r.a !== w.id && r.b !== w.id);
  if (state.selected === w) state.selected = null;
  state.path = null; save(); refreshEditBar(); refreshRouteSelects();
  return true;
}

// ============================================================================
// Pathfinding (Dijkstra on travel days)
// ============================================================================
function findPath(fromId, toId, avoidWormholes) {
  const dist = new Map(), prev = new Map(), q = new Set(G.worlds.map(w => w.id));
  for (const id of q) dist.set(id, Infinity);
  dist.set(fromId, 0);
  while (q.size) {
    let u = null, best = Infinity;
    for (const id of q) if (dist.get(id) < best) { best = dist.get(id); u = id; }
    if (u === null || u === toId) break;
    q.delete(u);
    for (const r of G.routes) {
      if (avoidWormholes && r.kind === 'wormhole') continue;
      if (r.a !== u && r.b !== u) continue;
      const v = r.a === u ? r.b : r.a;
      if (!q.has(v)) continue;
      const nd = best + r.days;
      if (nd < dist.get(v)) { dist.set(v, nd); prev.set(v, { from: u, route: r }); }
    }
  }
  if (dist.get(toId) === Infinity) return null;
  const worlds = [toId], routes = new Set(), dir = new Map(), steps = [];
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur);
    routes.add(p.route.id); dir.set(p.route.id, p.route.a === p.from ? 1 : -1);
    steps.unshift({ from: p.from, to: cur, route: p.route });
    worlds.unshift(p.from); cur = p.from;
  }
  return { worlds, routes, dir, steps, total: dist.get(toId) };
}

// ============================================================================
// UI: helpers
// ============================================================================
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtPop(n) {
  n = +n || 0;
  if (!n) return 'Uninhabited';
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + ' billion';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' million';
  if (n >= 1e3) return Math.round(n / 1e3) + ' thousand';
  return String(n);
}
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
function closeMenus() { $('#menu').hidden = true; $('#searchResults').hidden = true; }
const dotFor = w => `<span class="dot" style="background:${TYPES[w.type].color};box-shadow:0 0 6px ${TYPES[w.type].color}"></span>`;

// ---------- Top bar ----------
const nameInput = $('#galaxyName');
nameInput.addEventListener('input', () => { G.name = nameInput.value; document.title = `${G.name} · Galaxy Explorer`; save(); });

document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
function setMode(m) {
  state.mode = m;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  document.body.classList.toggle('editing', m === 'edit');
  state.selected = null; state.selectedRoute = null; state.connectFrom = null;
  refreshEditBar();
}

$('#btnMenu').addEventListener('click', e => { e.stopPropagation(); const m = $('#menu'); m.hidden = !m.hidden; });
$('#menu').addEventListener('click', e => {
  const act = e.target.closest('button')?.dataset.act; if (!act) return;
  closeMenus();
  if (act === 'fit') fitView();
  if (act === 'new' && confirm('Replace the current galaxy with a newly generated one? (Export first if you want to keep it.)')) { setGalaxy(generateGalaxy(randSeed())); toast(`Welcome to ${G.name}`); }
  if (act === 'export') exportGalaxy();
  if (act === 'import') $('#importFile').click();
});
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap, .search')) closeMenus(); });

function exportGalaxy() {
  const blob = new Blob([JSON.stringify(G, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (G.name || 'galaxy').replace(/[^\w-]+/g, '_') + '.json';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { setGalaxy(normalize(JSON.parse(await f.text()))); toast(`Imported ${G.name}`); }
  catch (err) { toast('Could not import: ' + err.message); }
});

// ---------- Search ----------
const searchInput = $('#search'), searchRes = $('#searchResults');
searchInput.addEventListener('input', renderSearch);
searchInput.addEventListener('focus', renderSearch);
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const b = searchRes.querySelector('button'); if (b) b.click(); }
  if (e.key === 'Escape') { searchInput.blur(); closeMenus(); }
});
function renderSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { searchRes.hidden = true; return; }
  const hits = G.worlds.filter(w => (w.name + ' ' + w.type + ' ' + w.faction).toLowerCase().includes(q)).slice(0, 12);
  searchRes.innerHTML = hits.length
    ? hits.map(w => `<button data-id="${w.id}">${dotFor(w)}${esc(w.name)}<span class="meta">${w.type}</span></button>`).join('')
    : '<div class="empty" style="padding:8px 10px">No worlds found</div>';
  searchRes.hidden = false;
}
searchRes.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const w = worldById(b.dataset.id);
  closeMenus(); searchInput.value = ''; searchInput.blur();
  if (state.view === 'detail') closeWorld(() => focusWorld(w)); else focusWorld(w);
});
function focusWorld(w) {
  flyTo(w.x, w.y, Math.max(state.cam.zoom, 1.6), 900, () => { state.focusPulse = { id: w.id, t: performance.now() }; });
  if (state.mode === 'edit') { state.selected = w; refreshEditBar(); }
}

// ---------- Zoom controls ----------
$('#zoomCtl').addEventListener('click', e => {
  const z = e.target.closest('button')?.dataset.zoom; if (!z) return;
  if (z === 'fit') return fitView();
  flyTo(state.cam.x, state.cam.y, state.cam.zoom * (z === 'in' ? 1.6 : 1 / 1.6), 300);
});

// ---------- Route planner ----------
$('#btnRoute').addEventListener('click', () => toggleRoutePanel());
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { $('#' + b.dataset.close).hidden = true; $('#btnRoute').classList.remove('active'); }));
function toggleRoutePanel(show) {
  const p = $('#routePanel');
  p.hidden = show === undefined ? !p.hidden : !show;
  $('#btnRoute').classList.toggle('active', !p.hidden);
  if (!p.hidden) refreshRouteSelects();
}
function refreshRouteSelects() {
  const sorted = [...G.worlds].sort((a, b) => a.name.localeCompare(b.name));
  for (const id of ['#routeFrom', '#routeTo']) {
    const sel = $(id), cur = sel.value;
    sel.innerHTML = '<option value="">Choose a world…</option>' + sorted.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    if (worldById(cur)) sel.value = cur;
  }
}
$('#btnFindRoute').addEventListener('click', planRoute);
$('#avoidWormholes').addEventListener('change', () => { if (state.path) planRoute(); });
$('#btnClearRoute').addEventListener('click', () => { state.path = null; $('#routeResult').innerHTML = ''; });
function planRoute() {
  const a = $('#routeFrom').value, b = $('#routeTo').value, out = $('#routeResult');
  if (!a || !b) { out.innerHTML = '<p class="empty">Pick a start and destination.</p>'; return; }
  if (a === b) { out.innerHTML = '<p class="empty">You are already there.</p>'; return; }
  const p = findPath(a, b, $('#avoidWormholes').checked);
  state.path = p;
  if (!p) { out.innerHTML = '<p class="empty">No route connects these worlds.</p>'; return; }
  out.innerHTML = `<div class="total">${p.total} days · ${p.steps.length} jump${p.steps.length === 1 ? '' : 's'}</div><ol class="steps">` +
    `<li>${dotFor(worldById(a))}${esc(worldById(a).name)}<span class="via">start</span></li>` +
    p.steps.map(s => { const w = worldById(s.to); return `<li>${dotFor(w)}<a href="#" data-id="${w.id}" style="color:inherit">${esc(w.name)}</a><span class="via">${ROUTE_KINDS[s.route.kind].label} · ${s.route.days}d</span></li>`; }).join('') + '</ol>';
  // frame the path
  const ws = p.worlds.map(worldById);
  const xs = ws.map(w => w.x), ys = ws.map(w => w.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const zoom = Math.min((W - 420) / (x1 - x0 + 200), (H - 200) / (y1 - y0 + 200));
  if (state.view === 'galaxy') flyTo((x0 + x1) / 2 + 150 / zoom, (y0 + y1) / 2, clamp(zoom, 0.15, 2.5), 900);
}
$('#routeResult').addEventListener('click', e => {
  const a = e.target.closest('a[data-id]'); if (!a) return;
  e.preventDefault(); openWorld(worldById(a.dataset.id));
});

// ---------- Edit bar ----------
function refreshEditBar() {
  const bar = $('#editBar');
  if (state.mode !== 'edit' || state.view !== 'galaxy') { bar.hidden = true; return; }
  bar.hidden = false;
  const w = state.selected, r = state.selectedRoute && G.routes.find(x => x.id === state.selectedRoute);
  if (state.connectFrom) {
    bar.innerHTML = `<div class="hint grow">Click another world to connect it to <b>${esc(state.connectFrom.name)}</b> (clicking an already-connected world removes the route).</div><button class="btn small" data-e="cancel">Cancel</button>`;
  } else if (w) {
    bar.innerHTML = `<div class="title grow">${dotFor(w)}${esc(w.name)} <span class="hint">${w.type}</span></div>
      <button class="btn small" data-e="open">Open &amp; edit</button>
      <button class="btn small" data-e="connect">Connect…</button>
      <button class="btn small danger" data-e="delete">Delete</button>`;
  } else if (r) {
    const a = worldById(r.a), b = worldById(r.b);
    bar.innerHTML = `<div class="title grow">${esc(a.name)} ⇄ ${esc(b.name)}</div>
      <select data-e="kind">${Object.entries(ROUTE_KINDS).map(([k, v]) => `<option value="${k}" ${k === r.kind ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <label class="hint">Days <input type="number" min="1" value="${r.days}" data-e="days" style="width:64px;padding:5px 7px;border-radius:7px;border:1px solid var(--border);background:rgba(0,0,0,.35)"></label>
      <button class="btn small danger" data-e="delroute">Delete route</button>`;
  } else {
    bar.innerHTML = `<div class="hint grow"><b>Edit mode.</b> Double-click empty space to add a world · drag worlds to move them · select a world then <b>Connect…</b> (or Shift+click) to link worlds · click a route to change it.</div>`;
  }
}
$('#editBar').addEventListener('click', e => {
  const act = e.target.closest('[data-e]')?.dataset.e; if (!act) return;
  const w = state.selected;
  if (act === 'cancel') state.connectFrom = null;
  if (act === 'open' && w) return openWorld(w, true);
  if (act === 'connect' && w) state.connectFrom = w;
  if (act === 'delete' && w) deleteWorld(w);
  if (act === 'delroute') { G.routes = G.routes.filter(r => r.id !== state.selectedRoute); state.selectedRoute = null; state.path = null; save(); }
  refreshEditBar();
});
$('#editBar').addEventListener('change', e => {
  const r = G.routes.find(x => x.id === state.selectedRoute); if (!r) return;
  if (e.target.dataset.e === 'kind') r.kind = e.target.value;
  if (e.target.dataset.e === 'days') r.days = Math.max(1, Math.round(+e.target.value || 1));
  if (state.path) planRoute();
  save();
});

// ============================================================================
// World detail view
// ============================================================================
const detailEl = $('#detail'), panel = $('#detailPanel');
function openWorld(w, editing = false) {
  if (!w) return;
  state.hover = null; tooltip.hidden = true;
  state.detailEditing = editing;
  if (state.view === 'detail') { warpTo(w); return; }
  state.prevCam = { ...state.cam };
  state.view = 'opening';
  $('#editBar').hidden = true;
  flyTo(w.x, w.y, 7, 850, () => {
    getTexture(w, DETAIL_TEX);
    state.view = 'detail'; state.detail = w;
    detailEl.hidden = false; resize();
    renderPanel();
    requestAnimationFrame(() => detailEl.classList.add('show'));
    canvas.classList.add('dimmed');
  });
}
function closeWorld(done) {
  if (state.view !== 'detail') return;
  detailEl.classList.remove('show');
  canvas.classList.remove('dimmed');
  state.view = 'closing';
  setTimeout(() => {
    detailEl.hidden = true; state.detail = null; state.view = 'galaxy';
    const p = state.prevCam || state.cam;
    flyTo(p.x, p.y, Math.min(p.zoom, 2.5), 800, done);
    refreshEditBar();
  }, 300);
}
function warpTo(w) {
  pcanvas.classList.add('warp');
  setTimeout(() => {
    getTexture(w, DETAIL_TEX);
    state.detail = w; Object.assign(state.cam, { x: w.x, y: w.y });
    if (state.prevCam) { state.prevCam.x = w.x; state.prevCam.y = w.y; }
    renderPanel(); panel.scrollTop = 0;
    pcanvas.classList.remove('warp');
  }, 350);
}
$('#btnBack').addEventListener('click', () => closeWorld());
addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Escape') {
    if (state.view === 'detail') closeWorld();
    else { state.selected = null; state.selectedRoute = null; state.connectFrom = null; refreshEditBar(); }
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.mode === 'edit' && state.view === 'galaxy') {
    if (state.selected) deleteWorld(state.selected);
    else if (state.selectedRoute) { G.routes = G.routes.filter(r => r.id !== state.selectedRoute); state.selectedRoute = null; save(); refreshEditBar(); }
  }
});

function splitPoi(s) { const i = s.indexOf(' — '); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 3)]; }

function renderPanel() {
  const w = state.detail; if (!w) return;
  document.title = `${w.name} · Galaxy Explorer`;
  if (state.detailEditing) return renderEditForm(w);
  const links = routesOf(w).map(r => ({ r, o: otherEnd(r, w) })).sort((a, b) => a.r.days - b.r.days);
  const diam = Math.round(w.size * 1050).toLocaleString();
  panel.innerHTML = `
    <div class="badges">
      <span class="badge">${dotFor(w)}${w.type}</span>
      <span class="badge">${esc(w.faction)}</span>
      ${w.rings ? '<span class="badge">Ringed</span>' : ''}
    </div>
    <h1>${esc(w.name)}</h1>
    <p class="desc">${esc(w.description)}</p>
    <h2>Vital statistics</h2>
    <div class="stats">
      ${stat('Population', fmtPop(w.population))}
      ${stat('Climate', esc(w.climate))}
      ${stat('Avg. temperature', `${w.temperature}°C`)}
      ${stat('Surface gravity', `${w.gravity} g`)}
      ${stat('Day length', `${w.dayLength} h`)}
      ${stat('Diameter', `${diam} km`)}
      ${stat('Moons', w.moons)}
      ${stat('Coordinates', `${w.x}, ${w.y}`)}
    </div>
    <h2>Resources</h2>
    ${w.resources.length ? `<div class="chips">${w.resources.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div>` : '<p class="empty">None recorded.</p>'}
    <h2>Points of interest</h2>
    ${w.poi.length ? `<ul class="poi">${w.poi.map(p => { const [n, d] = splitPoi(p); return `<li><b>${esc(n)}</b>${d ? `<span>${esc(d)}</span>` : ''}</li>`; }).join('')}</ul>` : '<p class="empty">None recorded.</p>'}
    <h2>Routes from here (${links.length})</h2>
    ${links.length ? `<div class="links">${links.map(({ r, o }) => `<button data-travel="${o.id}">${dotFor(o)}<span>${esc(o.name)}</span><span class="kind">${ROUTE_KINDS[r.kind].icon} ${ROUTE_KINDS[r.kind].label} · ${r.days}d</span></button>`).join('')}</div>` : '<p class="empty">This world is isolated — connect it in Edit mode.</p>'}
    <div class="toolbar">
      <button class="btn" data-a="edit">Edit details</button>
      <button class="btn" data-a="route">Plan route from here</button>
      <button class="btn" data-a="reseed">New surface</button>
    </div>`;
}
const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;

function renderEditForm(w) {
  const f = (label, key, type = 'text', extra = '') => `<label class="field">${label}<input name="${key}" type="${type}" value="${esc(w[key])}" ${extra}></label>`;
  panel.innerHTML = `
    <h1 style="font-size:22px">Edit world</h1>
    <form class="form" id="worldForm">
      ${f('Name', 'name', 'text', 'required')}
      <div class="two">
        <label class="field">Type<select name="type">${TYPE_NAMES.map(t => `<option ${t === w.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        ${f('Faction', 'faction')}
      </div>
      <div class="two">${f('Population', 'population', 'number', 'min="0" step="1"')}${f('Climate', 'climate')}</div>
      <div class="two">${f('Avg. temperature (°C)', 'temperature', 'number')}${f('Gravity (g)', 'gravity', 'number', 'step="0.01" min="0"')}</div>
      <div class="two">${f('Day length (h)', 'dayLength', 'number', 'step="0.1" min="1"')}${f('Size (map units)', 'size', 'number', 'min="4" max="30"')}</div>
      <div class="two">${f('Moons', 'moons', 'number', 'min="0" max="8"')}<label class="field check"><input type="checkbox" name="rings" ${w.rings ? 'checked' : ''}> Planetary rings</label></div>
      <label class="field">Description<textarea name="description">${esc(w.description)}</textarea></label>
      <label class="field">Resources (comma separated)<input name="resources" value="${esc(w.resources.join(', '))}"></label>
      <label class="field">Points of interest (one per line, "Name — note")<textarea name="poi">${esc(w.poi.join('\n'))}</textarea></label>
      <div class="toolbar">
        <button class="btn primary" type="submit">Save</button>
        <button class="btn" type="button" data-a="cancel">Cancel</button>
        <button class="btn danger" type="button" data-a="delete" style="margin-left:auto">Delete world</button>
      </div>
    </form>`;
  $('#worldForm').addEventListener('submit', e => {
    e.preventDefault();
    const d = new FormData(e.target);
    const num = (k, def) => { const v = parseFloat(d.get(k)); return Number.isFinite(v) ? v : def; };
    Object.assign(w, {
      name: String(d.get('name')).trim() || w.name,
      type: TYPES[d.get('type')] ? d.get('type') : w.type,
      faction: String(d.get('faction')).trim(),
      population: Math.max(0, Math.round(num('population', 0))),
      climate: String(d.get('climate')).trim(),
      temperature: Math.round(num('temperature', w.temperature)),
      gravity: num('gravity', w.gravity),
      dayLength: Math.max(1, num('dayLength', w.dayLength)),
      size: clamp(Math.round(num('size', w.size)), 4, 30),
      moons: clamp(Math.round(num('moons', w.moons)), 0, 8),
      rings: d.get('rings') === 'on',
      description: String(d.get('description')).trim(),
      resources: String(d.get('resources')).split(',').map(s => s.trim()).filter(Boolean),
      poi: String(d.get('poi')).split('\n').map(s => s.trim()).filter(Boolean),
    });
    state.detailEditing = false; save(); renderPanel(); refreshRouteSelects();
    toast('Saved');
  });
}

panel.addEventListener('click', e => {
  const t = e.target.closest('[data-travel], [data-a]'); if (!t) return;
  const w = state.detail;
  if (t.dataset.travel) { state.detailEditing = false; return warpTo(worldById(t.dataset.travel)); }
  const a = t.dataset.a;
  if (a === 'edit') { state.detailEditing = true; renderPanel(); }
  if (a === 'cancel') { state.detailEditing = false; renderPanel(); }
  if (a === 'reseed') { w.seed = randSeed(); getTexture(w, DETAIL_TEX); save(); toast('Surface regenerated'); }
  if (a === 'route') { closeWorld(() => { toggleRoutePanel(true); $('#routeFrom').value = w.id; $('#routeTo').focus(); }); }
  if (a === 'delete') { if (deleteWorld(w)) { state.detailEditing = false; closeWorld(); } }
});

// ============================================================================
// Boot
// ============================================================================
function setGalaxy(g) {
  G = g;
  state.path = null; state.selected = null; state.selectedRoute = null; state.connectFrom = null;
  nameInput.value = G.name; document.title = `${G.name} · Galaxy Explorer`;
  buildDust(); refreshRouteSelects(); refreshEditBar();
  fitView(false);
  save();
}

resize();
setGalaxy(load());
requestAnimationFrame(frame);
