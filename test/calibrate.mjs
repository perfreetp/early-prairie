// Paddock calibration: find the count and stamina where the local packing flips.
import { World } from '../src/world.js';
import { Herd, P, setPaddockGeometry } from '../src/herd.js';

const DT = 1 / 30;
const PX = 3540, PY = 2360, PR = 120;
setPaddockGeometry(PX, PY, PR);

function rngFrom(s) { let a = s; return () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; }; }

function mk(count, stam) {
  const world = new World(); world.build(0.5);
  const herd = new Herd(world, 4000); herd.setSeason(0.5);
  herd.addGroup(4, { rallyX: PX, rallyY: PY, rallyR: PR * 1.1 });
  const rnd = rngFrom(5);
  for (let k = 0; k < count; k++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * PR * 0.9;
    const i = herd.add(PX + Math.cos(a) * r, PY + Math.sin(a) * r, 4, stam);
    herd.paddock[i] = 1;
  }
  return herd;
}

function avgCrowd(h) { let c = 0; for (let i = 0; i < h.n; i++) c += h.crowd[i]; return c / h.n; }

for (const count of [150, 200, 250, 300]) {
  for (const stam of [0.3, 0.45, 0.55, 0.65, 0.8]) {
    const h = mk(count, stam);
    for (let i = 0; i < 15 / DT; i++) h.step(DT);
    const e0 = h.stampedeEvents;
    let cSum = 0, n = 0;
    for (let i = 0; i < 10 / DT; i++) {
      h.step(DT);
      if (i % 5 === 0) { cSum += avgCrowd(h); n++; }
    }
    h.computeStats();
    console.log(`count=${String(count).padStart(3)} stam=${stam.toFixed(2)} crowd=${(cSum / n).toFixed(2)} NN=${h.stats.meanNN.toFixed(1)} ev=${String(h.stampedeEvents - e0).padStart(4)} stamp=${String(h.stats.stampede).padStart(3)} alerted=${String(h.stats.alerted).padStart(3)}`);
  }
  console.log('');
}
