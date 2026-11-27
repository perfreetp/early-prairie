import { makeHerd, retargetGroups, GROUPS } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World(); w.build(0.95);
const h=makeHerd(w,{pop:900, season:0.95, seed:13});
retargetGroups(h, 0.95);
for(let i=0;i<150*30;i++) h.step(1/30);
for (const def of GROUPS) {
  const pts=[];
  for(let i=0;i<h.n;i++){ if(h.paddock[i]||h.group[i]!==def.id)continue; pts.push([h.x[i],h.y[i]]); }
  if(!pts.length) continue;
  let cx=0,cy=0; for(const p of pts){cx+=p[0];cy+=p[1];} cx/=pts.length;cy/=pts.length;
  let m2x=0,m2y=0,mxy=0; for(const p of pts){const dx=p[0]-cx,dy=p[1]-cy;m2x+=dx*dx;m2y+=dy*dy;mxy+=dx*dy;}
  m2x/=pts.length;m2y/=pts.length;mxy/=pts.length;
  const tr=m2x+m2y,det=m2x*m2y-mxy*mxy,disc=Math.sqrt(Math.max(0,tr*tr*0.25-det));
  const l1=tr*0.5+disc, l2=Math.max(1e-9,tr*0.5-disc);
  const elo=Math.sqrt(l1/l2);
  // major axis direction
  const eig=(m2x>m2y)? [1, mxy/(m2x-l1+1e-9)] : [mxy/(m2y-l1+1e-9), 1];
  const n=Math.hypot(eig[0],eig[1]);
  console.log(def.name.padEnd(4),'elo',elo.toFixed(2),'sd_major',Math.sqrt(l1).toFixed(0),'sd_minor',Math.sqrt(l2).toFixed(0),
    'axis',(eig[0]/n).toFixed(2)+','+(eig[1]/n).toFixed(2));
}
