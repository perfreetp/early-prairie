import { makeHerd, retargetGroups, GROUPS } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World(); w.build(0.02);
const h=makeHerd(w,{pop:1500, season:0.02, seed:13});
retargetGroups(h, 0.02);
function groupRadii(){
  return GROUPS.map(def=>{
    let n=0,cx=0,cy=0;
    for(let i=0;i<h.n;i++){ if(h.group[i]!==def.id)continue; cx+=h.x[i];cy+=h.y[i];n++; }
    if(!n) return null;
    cx/=n;cy/=n;
    let r=0; for(let i=0;i<h.n;i++){if(h.group[i]!==def.id)continue; r+=Math.hypot(h.x[i]-cx,h.y[i]-cy);}
    let md=0; for(let i=0;i<h.n;i++){if(h.group[i]!==def.id)continue; const d=Math.hypot(h.x[i]-cx,h.y[i]-cy); if(d>md)md=d;}
    return {c:[Math.round(cx),Math.round(cy)], mean:Math.round(r/n), max:Math.round(md)};
  });
}
const line=(t)=>{ const rs=groupRadii(); const mean=rs.reduce((a,b)=>a+(b?b.mean:0),0)/rs.filter(Boolean).length; h.computeStats(); return `t=${t.toFixed(2)} meanGroupRad=${mean.toFixed(0)} stam=${h.stats.meanStam.toFixed(2)} elo=${h.stats.elongation.toFixed(1)}`; };
for(let i=0;i<30*30;i++) h.step(1/30);
console.log(line(0.0));
for (let t=0.1; t<=1.001; t+=0.1) {
  w.build(t); h.setSeason(t); retargetGroups(h, t);
  for (let i=0;i<25*30; i++) h.step(1/30);
  console.log(line(t));
}
