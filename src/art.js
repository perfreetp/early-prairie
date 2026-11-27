// Procedural art: top-down quadruped atlas, terrain canvas, dots.
// Everything is drawn into plain canvases so it can be uploaded as a texture.

export const ATLAS = {
  cellW: 192, cellH: 128, cols: 10, rows: 12,
  poses: 5,      // graze, walk, alert, trot, gallop
  frames: 6,     // gait frames per pose
  tints: 4,
  bodyPx: 60,    // body length inside a cell (head tip reaches ~±95; cell half-width is 96)
};

// palette: four coat tints, all sandy/ashy so the whole thing reads as one herd
const COATS = [
  { body: '#c8b18d', dark: '#8e7a5d', belly: '#e0d0b2', head: '#b7a081' },
  { body: '#b49a77', dark: '#7d6a50', belly: '#d5c3a2', head: '#a48e6d' },
  { body: '#d3bf9c', dark: '#9a8666', belly: '#ecdfc6', head: '#c2ae8b' },
  { body: '#a8906f', dark: '#75634a', belly: '#c9b795', head: '#967f60' },
];

// pose → body proportions, head carriage, stride amplitude
//   neck: 0 = head down on the grass, 1 = head level with the back
//   reach: how far forward the head sits
const POSE = [
  { name: 'graze', len: 0.98, neck: 0.06, reach: 0.60, stride: 0.12, bob: 0.30, spread: 0.16 },
  { name: 'walk', len: 1.02, neck: 0.62, reach: 0.78, stride: 0.58, bob: 0.10, spread: 0.10 },
  { name: 'alert', len: 1.00, neck: 1.00, reach: 0.66, stride: 0.10, bob: 0.03, spread: 0.06 },
  { name: 'trot', len: 1.06, neck: 0.74, reach: 0.84, stride: 1.00, bob: 0.16, spread: 0.14 },
  { name: 'gallop', len: 1.12, neck: 0.66, reach: 0.92, stride: 1.55, bob: 0.24, spread: 0.20 },
];

function ctx2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  return [c, g];
}

/**
 * Draw one animal frame. The animal faces +x (right); the renderer rotates it.
 * cx,cy is the animal's centre inside the cell; s is the body length in px.
 */
function drawBeast(g, cx, cy, s, pose, frame, coat) {
  const p = POSE[pose];
  const L = s * p.len;                 // body length
  const Wd = s * 0.42;                 // body width
  const t = frame / ATL_FRAMES;        // 0..1 gait phase
  const ph = t * Math.PI * 2;
  const bob = Math.sin(ph * 2) * p.bob * s * 0.045;
  const OUT = 'rgba(58,45,28,0.80)';

  g.save();
  g.translate(cx, cy + bob);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // ---- ground shadow, offset and soft ----
  g.save();
  g.globalAlpha = 0.20;
  g.fillStyle = '#231a0c';
  g.beginPath();
  g.ellipse(-L * 0.04, Wd * 0.80, L * 0.50, Wd * 0.46, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // ---- legs: four, drawn with a knee so the gait reads ----
  const legLen = Wd * 1.15;
  const legs = [
    { fx: 0.30, side: -1, off: 0 },
    { fx: 0.30, side: 1, off: Math.PI * 0.9 },
    { fx: -0.30, side: -1, off: Math.PI * 0.5 },
    { fx: -0.30, side: 1, off: Math.PI * 1.4 },
  ];
  for (const lg of legs) {
    const sw = Math.sin(ph + lg.off) * p.stride;
    const lift = Math.max(0, Math.cos(ph + lg.off)) * p.stride * 0.5;
    const bx = lg.fx * L;
    const by = lg.side * Wd * 0.44;
    const reach = s * (0.13 + p.spread * 0.25);
    const ex = bx + sw * s * 0.17;
    const ey = by + lg.side * (legLen * 0.52 + lift * s * 0.10);
    g.strokeStyle = OUT;
    g.lineWidth = Math.max(1.4, s * 0.105);
    g.beginPath(); g.moveTo(bx, by); g.lineTo((bx + ex) * 0.5, (by + ey) * 0.5 + reach * 0.12); g.lineTo(ex, ey); g.stroke();
    g.strokeStyle = coat.dark;
    g.lineWidth = Math.max(1.0, s * 0.075);
    g.beginPath(); g.moveTo(bx, by); g.lineTo((bx + ex) * 0.5, (by + ey) * 0.5 + reach * 0.12); g.lineTo(ex, ey); g.stroke();
    // hoof
    g.fillStyle = '#5a4a33';
    g.beginPath(); g.arc(ex, ey, Math.max(1, s * 0.045), 0, Math.PI * 2); g.fill();
  }

  // ---- tail ----
  const ts = Math.sin(ph * 0.5) * s * 0.06;
  g.strokeStyle = OUT;
  g.lineWidth = Math.max(1.2, s * 0.075);
  g.beginPath();
  g.moveTo(-L * 0.46, 0);
  g.quadraticCurveTo(-L * 0.60, ts, -L * 0.70, ts * 1.8);
  g.stroke();
  g.strokeStyle = '#6d5a40';
  g.lineWidth = Math.max(0.8, s * 0.05);
  g.stroke();

  // ---- body: barrel + chest, a silhouette rather than an ellipse ----
  const grd = g.createLinearGradient(0, -Wd, 0, Wd);
  grd.addColorStop(0, coat.body);
  grd.addColorStop(0.46, coat.belly);
  grd.addColorStop(1, coat.body);
  g.fillStyle = grd;
  g.strokeStyle = OUT;
  g.lineWidth = Math.max(1.2, s * 0.045);
  g.beginPath();
  g.moveTo(-L * 0.48, -Wd * 0.10);
  g.bezierCurveTo(-L * 0.44, -Wd * 0.62, -L * 0.10, -Wd * 0.70, L * 0.12, -Wd * 0.64);
  g.bezierCurveTo(L * 0.34, -Wd * 0.60, L * 0.44, -Wd * 0.36, L * 0.46, 0);
  g.bezierCurveTo(L * 0.44, Wd * 0.36, L * 0.34, Wd * 0.60, L * 0.12, Wd * 0.64);
  g.bezierCurveTo(-L * 0.10, Wd * 0.70, -L * 0.44, Wd * 0.62, -L * 0.48, Wd * 0.10);
  g.closePath();
  g.fill();
  g.stroke();

  // haunch and shoulder mass
  g.fillStyle = 'rgba(88,70,46,0.20)';
  g.beginPath(); g.ellipse(-L * 0.28, 0, L * 0.16, Wd * 0.52, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(L * 0.22, 0, L * 0.13, Wd * 0.46, 0, 0, Math.PI * 2); g.fill();

  // dorsal ridge + a couple of flank stripes
  g.strokeStyle = 'rgba(74,58,38,0.34)';
  g.lineWidth = Math.max(1, s * 0.055);
  g.beginPath(); g.moveTo(-L * 0.30, 0); g.lineTo(L * 0.26, 0); g.stroke();
  g.strokeStyle = 'rgba(74,58,38,0.16)';
  g.lineWidth = Math.max(0.8, s * 0.035);
  for (let k = -2; k <= 2; k++) {
    g.beginPath();
    g.moveTo(-L * 0.10, k * Wd * 0.30 - Wd * 0.10);
    g.lineTo(L * 0.16, k * Wd * 0.30 - Wd * 0.04);
    g.stroke();
  }

  // ---- neck: an actual tapered trapezoid, not a stick ----
  const lift = p.neck;
  const nkBaseX = L * 0.32;
  const nkLen = L * (0.20 + 0.17 * p.reach);
  const nkAng = lerp(1.30, 0.14, lift);       // radians below the body axis
  const headX = nkBaseX + Math.cos(nkAng) * nkLen;
  const headY = Math.sin(nkAng) * nkLen;

  g.fillStyle = coat.body;
  g.strokeStyle = OUT;
  g.lineWidth = Math.max(1.1, s * 0.04);
  const nkW0 = Wd * 0.62, nkW1 = Wd * 0.46;
  const nx = -Math.sin(nkAng), ny = Math.cos(nkAng);   // perpendicular
  g.beginPath();
  g.moveTo(nkBaseX + nx * nkW0, ny * nkW0);
  g.lineTo(headX + nx * nkW1, headY + ny * nkW1);
  g.lineTo(headX - nx * nkW1, headY - ny * nkW1);
  g.lineTo(nkBaseX - nx * nkW0, -ny * nkW0);
  g.closePath();
  g.fill();
  g.stroke();
  // mane along the neck
  g.strokeStyle = coat.dark;
  g.lineWidth = Math.max(1, s * 0.075);
  g.beginPath(); g.moveTo(nkBaseX, -Wd * 0.06); g.lineTo(headX - nx * nkW1 * 0.6, headY); g.stroke();

  // ---- head ----
  const hAng = nkAng - 0.28;                  // head tips down a touch more
  g.save();
  g.translate(headX, headY);
  g.rotate(hAng);
  const hl = s * 0.38, hw = s * 0.195;
  g.fillStyle = coat.head;
  g.strokeStyle = OUT;
  g.lineWidth = Math.max(1, s * 0.04);
  g.beginPath();
  g.moveTo(-hl * 0.42, -hw * 0.86);          // jaw hinge, wide
  g.bezierCurveTo(hl * 0.05, -hw * 1.00, hl * 0.30, -hw * 0.70, hl * 0.52, -hw * 0.30);
  g.bezierCurveTo(hl * 0.62, -hw * 0.10, hl * 0.62, hw * 0.10, hl * 0.52, hw * 0.30);
  g.bezierCurveTo(hl * 0.30, hw * 0.70, hl * 0.05, hw * 1.00, -hl * 0.42, hw * 0.86);
  g.closePath();
  g.fill();
  g.stroke();
  // muzzle
  g.fillStyle = '#5f4c34';
  g.beginPath(); g.ellipse(hl * 0.47, 0, hl * 0.15, hw * 0.26, 0, 0, Math.PI * 2); g.fill();
  // ears, which swing with the phase
  const earA = Math.sin(ph) * 0.12;
  g.fillStyle = coat.dark;
  for (const sd of [-1, 1]) {
    g.save();
    g.translate(-hl * 0.20, sd * hw * 0.74);
    g.rotate(sd * (0.75 + earA));
    g.beginPath();
    g.ellipse(0, -s * 0.045, s * 0.052, s * 0.028, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // eye
  g.fillStyle = '#241a0e';
  g.beginPath(); g.arc(hl * 0.10, -hw * 0.46, Math.max(0.9, s * 0.030), 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(hl * 0.10, hw * 0.46, Math.max(0.9, s * 0.030), 0, Math.PI * 2); g.fill();
  g.restore();

  g.restore();
}

let ATL_FRAMES = 6;
const lerp = (a, b, t) => a + (b - a) * t;

export function buildAnimalAtlas(scale = 1.6) {
  const { cellW, cellH, cols, rows, poses, frames, tints } = ATLAS;
  ATL_FRAMES = frames;
  const [canvas, g] = ctx2d(cellW * scale * cols, cellH * scale * rows);
  g.scale(scale, scale);
  const s = ATLAS.bodyPx;
  const framesOut = [];
  for (let pi = 0; pi < poses; pi++) {
    for (let fi = 0; fi < frames; fi++) {
      for (let ti = 0; ti < tints; ti++) {
        const idx = pi * frames * tints + fi * tints + ti;
        const col = idx % cols, row = (idx / cols) | 0;
        if (row >= rows) continue;
        const cx = col * cellW + cellW * 0.5;
        const cy = row * cellH + cellH * 0.5;
        g.save();
        g.beginPath();
        g.rect(col * cellW, row * cellH, cellW, cellH);
        g.clip();
        drawBeast(g, cx, cy, s, pi, fi, COATS[ti]);
        g.restore();
        framesOut.push({ pose: pi, frame: fi, tint: ti, x: col * cellW, y: row * cellH });
      }
    }
  }
  return { canvas, frames: framesOut, cellW, cellH, ATLAS_COLS: cols, scale };
}

/* ---------------------------------------------------------------- terrain */

const TERRAIN_W = 1500;

export function buildTerrainCanvas(world, opts = {}) {
  const W = TERRAIN_W;
  const H = Math.round(TERRAIN_W * world.h / world.w);
  const [canvas, g] = ctx2d(W, H);
  const sx = world.w / W, sy = world.h / H;
  const wet = opts.wet ?? 0.5;

  // palette: dry ochre (cracked earth) → wet olive (grass)
  const dryA = [178, 150, 104], dryB = [199, 174, 128];
  const wetA = [116, 116, 70], wetB = [146, 148, 92];

  // one pass with bilinear-ish jitter so the low-res sampling doesn't band
  const img = g.createImageData(W, H);
  const d = img.data;
  const jitter = (x, y) => {
    const n = ((x * 374761393) ^ (y * 668265263)) >>> 0;
    return ((n ^ (n >>> 13)) % 1000) / 1000 - 0.5;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = (x + 0.5) * sx, wy = (y + 0.5) * sy;
      const m = world.moistAt(wx, wy);
      const e = world.elevAt(wx, wy);
      const k = m * 0.88 + wet * 0.12;
      const tt = clamp01((e - 0.24) * 1.5);
      const j = jitter(x, y) * 7;
      const i = (y * W + x) * 4;
      d[i] = lerp(lerp(dryA[0], wetA[0], k), lerp(dryB[0], wetB[0], k), tt) + j;
      d[i + 1] = lerp(lerp(dryA[1], wetA[1], k), lerp(dryB[1], wetB[1], k), tt) + j;
      d[i + 2] = lerp(lerp(dryA[2], wetA[2], k), lerp(dryB[2], wetB[2], k), tt) + j * 0.8;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // soften: the field is sampled coarsely, so a couple of blur passes keep it
  // from looking like blocks at close zoom
  g.save();
  g.globalAlpha = 0.5;
  g.filter = 'blur(3px)';
  g.drawImage(canvas, 0, 0);
  g.restore();
  g.filter = 'none';

  // ---------------------------------------------------------- overlays
  // broad moisture mottling: darker damp patches, drawn as soft blobs
  g.save();
  let seed = 313;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  g.filter = 'blur(9px)';
  for (let k = 0; k < 90; k++) {
    const x = rnd() * W, y = rnd() * H;
    const m = world.moistAt(x * sx, y * sy);
    const r = 18 + rnd() * 60;
    const damp = m > 0.52;
    g.fillStyle = damp ? 'rgba(96,104,56,0.16)' : 'rgba(140,116,70,0.13)';
    g.beginPath();
    g.ellipse(x, y, r * 1.5, r, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  g.restore();

  // ---------------------------------------------------------- water
  // drawn with a wobbly shoreline so it does not read as a perfect disc
  for (let p = 0; p < world.pools.length; p++) {
    const r = world.poolR[p];
    if (r <= 1) continue;
    const pool = world.pools[p];
    const cxr = pool.x * sx, cyr = pool.y * sy, rr = r * sx;
    const lobes = 26;
    drawWobblyDisc(g, cxr, cyr, rr, lobes, p, 'rgba(58,104,112,0.92)');
    drawWobblyDisc(g, cxr, cyr, rr * 0.86, lobes, p + 7, 'rgba(44,86,96,0.95)');
    // damp rim
    drawWobblyDisc(g, cxr, cyr, rr * 1.16, lobes, p + 3, 'rgba(120,124,80,0.24)');
    // shoreline light
    g.strokeStyle = 'rgba(226,220,190,0.34)';
    g.lineWidth = 1.2;
    strokeWobbly(g, cxr, cyr, rr, lobes, p);
  }

  return canvas;
}

function wobbleRadius(base, ang, seed) {
  const a = Math.sin(ang * 3 + seed * 1.7) * 0.055
    + Math.sin(ang * 5.3 + seed * 2.9) * 0.035
    + Math.sin(ang * 9.1 + seed * 0.6) * 0.018;
  return base * (1 + a);
}

function drawWobblyDisc(g, cx, cy, r, lobes, seed, fill) {
  g.fillStyle = fill;
  g.beginPath();
  for (let k = 0; k <= lobes; k++) {
    const a = (k / lobes) * Math.PI * 2;
    const rr = wobbleRadius(r, a, seed);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.82;
    if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}

function strokeWobbly(g, cx, cy, r, lobes, seed) {
  g.beginPath();
  for (let k = 0; k <= lobes; k++) {
    const a = (k / lobes) * Math.PI * 2;
    const rr = wobbleRadius(r, a, seed);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.82;
    if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.stroke();
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Small soft dot used for the far zoom level. */
export function buildDotTexture(size = 24) {
  const [c, g] = ctx2d(size, size);
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.95)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/**
 * A horizontal strip of state dots, one cell per state, used when the herd is
 * drawn at a zoom where a whole animal would be under a pixel or two.
 */
export const DOT_COLORS = ['#cfc49b', '#f0dca0', '#ffd166', '#79d0ff', '#ff6a55'];
export function buildDotAtlas(cell = 48) {
  const n = DOT_COLORS.length;
  const [c, g] = ctx2d(cell * n, cell);
  for (let k = 0; k < n; k++) {
    const cx = k * cell + cell / 2, cy = cell / 2;
    const rad = cell * 0.40;
    const grd = g.createRadialGradient(cx, cy - cell * 0.08, rad * 0.1, cx, cy, rad);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.35, DOT_COLORS[k]);
    grd.addColorStop(1, shade(DOT_COLORS[k], -0.35));
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }
  return { canvas: c, count: n };
}

function shade(hex, amt) {
  const v = parseInt(hex.slice(1), 16);
  let r = (v >> 16) & 255, gg = (v >> 8) & 255, b = v & 255;
  const f = (x) => Math.max(0, Math.min(255, Math.round(x + (amt > 0 ? (255 - x) * amt : x * amt))));
  r = f(r); gg = f(gg); b = f(b);
  return `rgb(${r},${gg},${b})`;
}

/**
 * A tileable tuft/pebble detail layer, transparent except for fine strokes.
 * Tiled over the terrain and faded in only at close zoom, so the ground keeps
 * texture when a whole herd is on screen.
 */
export function buildDetailTexture(size = 256) {
  const [c, g] = ctx2d(size, size);
  let seed = 4242;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  // wrap a stroke across tile edges so tiling is seamless
  const strokeWrapped = (draw) => {
    for (const [ox, oy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
      g.save(); g.translate(ox, oy); draw(); g.restore();
    }
  };
  for (let k = 0; k < 420; k++) {
    const x = rnd() * size, y = rnd() * size;
    const h = 3 + rnd() * 6;
    const lean = (rnd() - 0.5) * 5;
    const dark = rnd() > 0.5;
    strokeWrapped(() => {
      g.strokeStyle = dark ? 'rgba(60,50,30,0.26)' : 'rgba(206,190,140,0.22)';
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + lean * 0.5, y - h * 0.6, x + lean, y - h);
      g.stroke();
    });
  }
  for (let k = 0; k < 90; k++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 0.7 + rnd() * 1.6;
    const dark = rnd() > 0.4;
    strokeWrapped(() => {
      g.fillStyle = dark ? 'rgba(58,48,30,0.20)' : 'rgba(214,199,152,0.20)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    });
  }
  return c;
}

/** Dry ground detail: a sparse crack network. */
export function buildCrackTexture(size = 256) {
  const [c, g] = ctx2d(size, size);
  let seed = 777;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const wrap = (draw) => {
    for (const [ox, oy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
      g.save(); g.translate(ox, oy); draw(); g.restore();
    }
  };
  g.strokeStyle = 'rgba(62,48,28,0.34)';
  g.lineWidth = 0.9;
  for (let k = 0; k < 130; k++) {
    let x = rnd() * size, y = rnd() * size;
    let ang = rnd() * Math.PI * 2;
    const pts = [[x, y]];
    for (let s = 0; s < 4 + rnd() * 5; s++) {
      ang += (rnd() - 0.5) * 1.3;
      const len = 4 + rnd() * 12;
      x += Math.cos(ang) * len; y += Math.sin(ang) * len;
      pts.push([x, y]);
    }
    wrap(() => {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let s = 1; s < pts.length; s++) g.lineTo(pts[s][0], pts[s][1]);
      g.stroke();
    });
  }
  return c;
}

export { COATS, POSE };
