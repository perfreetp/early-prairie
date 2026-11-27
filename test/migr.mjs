// Does the population actually travel from wet range to dry water as season
// advances, if we just let it run?
import { makeHerd, retargetGroups } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World(); w.build(0.02);
const h=makeHerd(w,{pop:1500, season:0.02, seed:13});
retargetGroups(h, 0.02);
function stats(){
  let cx=0,cy=0,n=0; for(let i=0;i<h.n;i++){ if(h.paddock[i])continue; cx+=h.x[i];cy+=h.y[i];n++; } cx/=n;cy/=n;
  let r=0; for(let i=0;i<h.n;i++){if(h.paddock[i])continue; r+=Math.hypot(h.x[i]-cx,h.y[i]-cy);}
  h.computeStats();
  return {cx:Math.round(cx),cy:Math.round(cy),rad:Math.round(r/n),stam:+h.stats.meanStam.toFixed(2),elo:+h.stats.elongation.toFixed(1)};
}
console.log('wet start', JSON.stringify(stats()));
// advance the season in steps; each 0.1 of season runs 12 s of sim
for (let t=0.1; t<=1.001; t+=0.1) {
  w.build(t); h.setSeason(t); retargetGroups(h, t);
  for (let i=0;i<12/ (1/30); i++) h.step(1/30);
  console.log('season', t.toFixed(1), JSON.stringify(stats()));
}
