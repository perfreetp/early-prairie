import { makeHerd, retargetGroups, GROUPS } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World();
const h=makeHerd(w,{pop:1400, season:0.05, seed:13});
for(let i=0;i<40*30;i++) h.step(1/30);
function groupShape(){
  const out=[];
  for (const def of GROUPS) {
    let n=0,cx=0,cy=0;
    for(let i=0;i<h.n;i++){ if(h.paddock[i]||h.group[i]!==def.id)continue; cx+=h.x[i];cy+=h.y[i];n++; }
    cx/=n;cy/=n;
    let m2x=0,m2y=0,mxy=0;
    for(let i=0;i<h.n;i++){ if(h.paddock[i]||h.group[i]!==def.id)continue; const dx=h.x[i]-cx,dy=h.y[i]-cy; m2x+=dx*dx;m2y+=dy*dy;mxy+=dx*dy; }
    m2x/=n;m2y/=n;mxy/=n;
    const tr=m2x+m2y,det=m2x*m2y-mxy*mxy,disc=Math.sqrt(Math.max(0,tr*tr*0.25-det));
    out.push({g:def.name, elo:+(Math.sqrt((tr*0.5+disc)/Math.max(1e-9,tr*0.5-disc))).toFixed(1), rad:+Math.sqrt((m2x+m2y)/2).toFixed(0)});
  }
  return out;
}
console.log('wet', JSON.stringify(groupShape()));
let prev=0;
for (const t of [0.45, 0.75, 0.95]) {
  w.build(t); h.setSeason(t); retargetGroups(h, t);
  for (const sec of [5, 30, 120]) {
    for(let i=0;i<(sec-prev)*30;i++) h.step(1/30);
    prev=sec;
    h.computeStats();
    console.log('t',t,'+'+sec+'s', JSON.stringify(groupShape()), 'stam', h.stats.meanStam.toFixed(2));
  }
  prev=0;
}
