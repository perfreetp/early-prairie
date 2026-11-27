import { World } from '../src/world.js';
import { Herd, ST, P } from '../src/herd.js';

const DT = 1/30;
const PX = 3500, PY = 2380, PR = 118;
function rngFrom(s){ let a=s; return ()=>{ a=(a*16807)%2147483647; return (a-1)/2147483646; }; }

function fmt(h){
  h.computeStats(); const s=h.stats;
  return `NN=${s.meanNN.toFixed(1).padStart(5)} stam=${s.meanStam.toFixed(2)} R=${s.meanR.toFixed(0).padStart(3)} `+
  `press=${(s.meanPressure||0).toFixed(2)} files=${String(s.files).padStart(4)} maxD=${String(s.maxDepth).padStart(3)} `+
  `elo=${s.elongation.toFixed(1).padStart(4)} graze=${String(s.grazing).padStart(4)} foll=${String(s.following).padStart(4)} `+
  `alert=${String(s.fleeing).padStart(4)} stamp=${String(s.stampede).padStart(3)} sw=${String(s.switches).padStart(6)} stmp=${String(s.stampedes).padStart(3)}`;
}

function mk(aridity, n, cx, cy, sigma, seed){
  const w = new World(); w.build(1-aridity);
  const h = new Herd(w, 9000); h.useSeed(seed*7919+3); h.setSeason(aridity);
  h.addGroup(0, {rallyX:cx, rallyY:cy, radius:sigma*2});
  const r = rngFrom(seed||1);
  for(let i=0;i<n;i++){ const a=r()*Math.PI*2, rr=Math.sqrt(r())*sigma;
    h.add(cx+Math.cos(a)*rr, cy+Math.sin(a)*rr, 0, 0.35+r()*0.6); }
  h.assignSeniority(true);
  return h;
}

console.log('=== A. same herd, three seasons (1200, 35 s) ===');
for(const [label, ar] of [['dry 0.95',0.95],['mid 0.50',0.50],['wet 0.05',0.05]]){
  const h = mk(ar, 1200, 1500, 1400, 300, 3);
  for(let i=0;i<35/DT;i++) h.step(DT);
  console.log(label.padEnd(16)+fmt(h));
}

console.log('\n=== B. one group, stamina forced down in steps ===');
{
  const h = mk(0.5, 500, 1500, 1400, 220, 5);
  for(const sv of [0.95,0.80,0.65,0.50,0.35,0.25]){
    for(let i=0;i<h.n;i++){ h.stam[i]=sv; h.updateBody(i); h.guide[i]=-1; }
    h.assignSeniority(true);
    for(let i=0;i<16/DT;i++) h.step(DT);
    console.log(`stam=${sv.toFixed(2)}`.padEnd(16)+fmt(h));
  }
}

console.log('\n=== C. migration: target moves, files form ===');
{
  const h = mk(0.5, 600, 1500, 1400, 200, 9);
  h.groups[0].target = {x:2200, y:1800, spread:40, strength:1};
  for(let s=0;s<36;s+=4){
    for(let i=0;i<4/DT;i++) h.step(DT);
    console.log(`+${s+4}s`.padEnd(16)+fmt(h));
  }
}

console.log('\n=== D. scent: plume from upwind sweeps the herd ===');
{
  const h = mk(0.5, 800, 1500, 1400, 320, 11);
  h.windA = Math.PI; h.windTarget = Math.PI;
  for(let i=0;i<8/DT;i++) h.step(DT);
  console.log('settled'.padEnd(16)+fmt(h));
  h.sources.push({x:1500+600, y:1400, radius:1100, strength:1, active:true});
  for(let s=0;s<12;s++){
    for(let i=0;i<1/DT;i++) h.step(DT);
    let up=0; for(let i=0;i<h.n;i++) if(h.vx[i]<-3) up++;
    console.log(`+${s+1}s`.padEnd(16)+fmt(h)+` upwind=${up}`);
  }
  h.sources.length = 0;
  for(let s=0;s<15;s+=3){
    for(let i=0;i<3/DT;i++) h.step(DT);
    console.log(`off+${s+3}s`.padEnd(16)+fmt(h));
  }
}

console.log('\n=== E. paddock sweep — count and stamina ===');
for(const count of [110,150,190]){
  for(const sv of [0.25,0.40,0.55,0.70,0.85]){
    const w=new World(); w.build(0.5);
    const h=new Herd(w,4000); h.useSeed(77); h.setSeason(0.5); h.setPaddockFence(PX,PY,PR);
    h.addGroup(4,{radius:PR});
    const r=rngFrom(5);
    for(let k=0;k<count;k++){ const a=r()*Math.PI*2, rr=Math.sqrt(r())*PR*0.92;
      h.add(PX+Math.cos(a)*rr, PY+Math.sin(a)*rr, 4, sv, {paddock:true}); }
    h.assignSeniority(true);
    for(let i=0;i<10/DT;i++) h.step(DT);
    const e0=h.stampedes; let pSum=0,n=0;
    for(let i=0;i<10/DT;i++){ h.step(DT); if(i%6===0){ const ps=h.paddockStats(); pSum+=ps.pressure; n++; } }
    const ps=h.paddockStats();
    console.log(`n=${String(count).padStart(3)} stam=${sv.toFixed(2)} press=${(pSum/n).toFixed(2)} tol=${(P.tolBase+P.tolGain*sv).toFixed(2)} stmp=${String(h.stampedes-e0).padStart(3)} now=${String(ps.stampeding).padStart(3)} NN=${h.stats.meanNN.toFixed(1)}`);
  }
  console.log('');
}
