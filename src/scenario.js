// Scenario: herd groups, the seasonal migration path, weather sources and the
// critical-density corner paddock.
//
// One season value t ∈ [0,1] drives the whole landscape:
//   t = 0  雨季 — forage everywhere, animals stop and graze, stamina recovers,
//                vigilance circles are wide, the herd relaxes into a loose scatter.
//   t = 1  旱季 — forage is gone, the only water is the shrinking lake, walking
//                burns stamina, circles shrink, everybody re-links to a nearer
//                animal and the population draws into files walking to water.
// The timeline therefore runs 雨季 → 旱季, which reads as sparse → dense.
import { mulberry32, clamp, lerp } from './rng.js';
import { Herd, P } from './herd.js';
import { WORLD } from './world.js';

export const LAKE = { x: 1290, y: 1290 };

// Five herds, each with a wide wet-season home range and a shared dry-season
// destination at the lake.
// `water` is where each group marches in the dry season. Kept apart so the five
// columns stay separate and readable instead of merging into one pile.
// The wet-season range sits far from the dry-season water on purpose: the
// timeline is a *migration*, so the herds have a real distance to walk.
export const GROUPS = [
  { id: 0, name: '北群', color: '#e3c98a', wet: [760, 380], water: [1180, 700], w: 0.22, r: 300 },
  { id: 1, name: '东群', color: '#d8b97b', wet: [3400, 500], water: [3050, 760], w: 0.21, r: 290 },
  { id: 2, name: '西群', color: '#cbb07a', wet: [330, 2050], water: [720, 2150], w: 0.20, r: 300 },
  { id: 3, name: '南群', color: '#dfc793', wet: [1850, 2620], water: [2060, 2150], w: 0.21, r: 280 },
  { id: 4, name: '高地群', color: '#cfb584', wet: [3620, 2280], water: [3010, 1760], w: 0.16, r: 280 },
];

// Measured by headless sweep (test/cal4.mjs): sustained stampede fraction falls
// from ~11% at 0.52 to ~2% at 0.55. The default sits just under the flip.
export const PADDOCK = {
  x: 3520, y: 2360, r: 122,
  count: 170,
  stamina: 0.545,
  flip: 0.535,
};

export function makeHerd(world, opts = {}) {
  const pop = opts.pop ?? 2600;
  const season = opts.season ?? 0.15;   // 0 = wet, 1 = dry
  const seed = opts.seed ?? 11;

  const herd = new Herd(world, 9000);
  herd.useSeed(seed * 7919 + 17);
  herd.setSeason(season);
  herd.setPaddockFence(PADDOCK.x, PADDOCK.y, PADDOCK.r);
  herd.windA = herd.windTarget = 0.62;

  const rnd = mulberry32(seed * 104729 + 5);

  for (const def of GROUPS) {
    herd.addGroup(def.id, { name: def.name, color: def.color, radius: def.r });
  }

  let totalW = 0;
  for (const def of GROUPS) totalW += def.w;

  const wet = 1 - season;
  for (const def of GROUPS) {
    const count = Math.round((def.w / totalW) * pop);
    // Each group lives around its own terrain feature, not around the lake: in
    // the dry season it is already gathered at its own last water, in the wet
    // season it is spread over the whole range. Using one shared centre would
    // put the dry-season spawn inside the lake and lose most of the group.
    const cx = lerp(def.water[0], def.wet[0], wet);
    const cy = lerp(def.water[1], def.wet[1], wet);
    const sigma = def.r * lerp(0.45, 1.45, wet);
    const stamBase = lerp(0.40, 0.86, wet);
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 80) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * sigma;
      const x = clamp(cx + Math.cos(a) * rr, 70, world.w - 70);
      const y = clamp(cy + Math.sin(a) * rr, 70, world.h - 70);
      if (world.drinkDist(x, y) < 20) continue;
      herd.add(x, y, def.id, clamp(stamBase + (rnd() - 0.5) * 0.34, 0.14, 1));
      placed++;
    }
  }

  herd.assignSeniority();

  if (opts.paddock !== false) {
    for (let k = 0; k < PADDOCK.count; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * PADDOCK.r * 0.92;
      herd.add(
        PADDOCK.x + Math.cos(a) * rr,
        PADDOCK.y + Math.sin(a) * rr,
        5, PADDOCK.stamina, { paddock: true, group: 5 }
      );
    }
    herd.addGroup(5, { name: '围栏', radius: PADDOCK.r, color: '#e8d9a8' });
    herd.assignSeniority();
  }

  herd.computeStats();
  return herd;
}

/** Point the herds at their destination for a season value (1 = dry). */
export function retargetGroups(herd, season) {
  // In the wet season there is nothing to walk to: forage is everywhere, so
  // every group simply grazes its own range. As the dry season comes on, the
  // only water left is the lake and every group heads for it — the one pull
  // that turns five scattered herds into a converging set of columns.
  // Only the last stretch of the dry season pulls every group onto the lake;
  // before that each group merely tightens up within its own range.
  const dryness = clamp((season - 0.42) / 0.50, 0, 1);
  for (const def of GROUPS) {
    const g = herd.groups[def.id];
    if (!g) continue;
    if (dryness < 0.02) {
      g.target = null;
    } else {
      // Every group marches to its own nearest remaining water. Because the
      // whole group walks the same way while each animal stations itself behind
      // its guide, the cluster stretches into a file along the line of travel —
      // the single-file column the brief asks for.
      const wx = def.water ? def.water[0] : LAKE.x;
      const wy = def.water ? def.water[1] : LAKE.y;
      const gx = def.wet[0], gy = def.wet[1];
      const march = Math.pow(dryness, 0.9);
      const tx = lerp(gx, wx, march * 0.55);
      const ty = lerp(gy, wy, march * 0.55);
      const dx = tx - gx, dy = ty - gy;
      const dl = Math.hypot(dx, dy) || 1;
      // A herd at the water does not stand still: it walks the shoreline to
      // graze and drink. That slow circuit is what keeps the file a file.
      const patrolR = lerp(0, 210, march);
      const patrolW = lerp(0.02, 0.055, march);
      g.target = {
        x: tx, y: ty,
        // home base near the water: the aim point wanders around it so the herd
        // keeps walking and the column keeps its shape
        waterX: tx, waterY: ty,
        patrolR: lerp(160, 420, march),
        patrolW: lerp(0.014, 0.034, march),
        phase: g.id * 1.31,
        // the direction of travel: inside the destination the herd lines up
        // along this axis, so it holds a column rather than a disc
        dirX: dx / dl, dirY: dy / dl,
        arriveR: lerp(def.r * 0.9, 130, march),
        spread: lerp(def.r * 0.7, 640, march),     // column length (half-extent)
        width: lerp(def.r * 0.10, 11, march),      // column half-width
        strength: 0.24 + 0.55 * dryness,
      };
    }
  }
}

export function setPaddockStamina(herd, value) {
  PADDOCK.stamina = value;
  for (let i = 0; i < herd.n; i++) {
    if (!herd.paddock[i]) continue;
    herd.stam[i] = value;
    herd.updateBody(i);
    herd.guide[i] = -1;
    herd.stress[i] = 0;
    herd.state[i] = 0;
    herd.stateT[i] = 0;
    herd.cool[i] = 0;
  }
  herd.assignSeniority();
}

export { P };
