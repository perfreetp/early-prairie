import { makeHerd, retargetGroups, GROUPS } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World(); w.build(0.05);
const h=makeHerd(w,{pop:1400, season:0.05, seed:13});
for(let i=0;i<30*30;i++) h.step(1/30);
function shapes(){
  const out=[];
  for (const def of GROUPS){
    let n=0,cx=0,cy=0;
    for(let i=0;i<h.n;i++){ if(h.paddock[i]||h.group[i]!==def.id)continue; cx+=h.x[i];cy+=h.y[i];n++; }
    if(!n){out.push(def.name+':-');continue;}
    cx/=n;cy/=n;
    let m2x=0,m2y=0,mxy=0;
    for(let i=0;i<h.n;i++){ if(h.paddock[i]||h.group[i]!==def.id)continue; const dx=h.x[i]-cx,dy=h.y[i]-cy; m2x+=dx*dx;m2y+=dy*dy;mxy+=dx*dy; }
    m2x/=n;m2y/=n;mxy/=n;
    const tr=m2x+m2y,det=m2x*m2y-mxy*mxy,disc=Math.sqrt(Math.max(0,tr*tr*0.25-det));
    const elo=Math.sqrt((tr*0.5+disc)/Math.max(1e-9,tr*0.5-disc));
    out.push(def.name+':'+elo.toFixed(1)+'/'+Math.sqrt((m2x+m2y)/2).toFixed(0));
  }
  return out.join(' ');
}
console.log('wet  ', shapes());
for (const t of [0.45, 0.7, 0.95]) {
  w.build(t); h.setSeason(t); retargetGroups(h, t);
  for (const sec of [8, 40, 150]) {
    for(let i=0;i<(sec-(h._s||0))*30;i++) h.step(1/30);
    h._s=sec;
    console.log(`t=${t} +${sec}s `, shapes(), 'stam', h.stats.meanStam.toFixed(2));
  }
  h._s=0;
}
