import { makeHerd, retargetGroups, GROUPS } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World(); w.build(0.05);
const h=makeHerd(w,{pop:1200, season:0.05, seed:13});
retargetGroups(h, 0.05);
for(let i=0;i<20*30;i++) h.step(1/30);
function rads(){
  const c=GROUPS.map(()=>({x:0,y:0,n:0}));
  for(let i=0;i<h.n;i++){ if(h.paddock[i])continue; const g=h.group[i]; if(g>=5)continue; c[g].x+=h.x[i]; c[g].y+=h.y[i]; c[g].n++; }
  return c.map((o,gi)=>{ o.x/=o.n; o.y/=o.n; let r=0; for(let i=0;i<h.n;i++){ if(h.paddock[i]||h.group[i]!==gi)continue; r+=Math.hypot(h.x[i]-o.x,h.y[i]-o.y);} return Math.round(r/o.n); });
}
console.log('wet radius', rads());
let prev=0;
for (const t of [0.5, 0.92]) {
  w.build(t); h.setSeason(t); retargetGroups(h, t);
  for (const sec of [4, 15, 60, 150]) {
    for(let i=0;i<(sec-prev)*30;i++) h.step(1/30);
    prev=sec;
    h.computeStats();
    console.log('t',t,'+'+sec+'s radius', rads(), 'R', h.stats.meanR.toFixed(0), 'files', h.stats.files);
  }
  prev=0;
}
