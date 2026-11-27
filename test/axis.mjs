import { makeHerd, retargetGroups, GROUPS } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World(); w.build(0.95);
const h=makeHerd(w,{pop:900, season:0.95, seed:13});
retargetGroups(h, 0.95);
for(let i=0;i<120*30;i++) h.step(1/30);
for (const def of GROUPS) {
  const g=h.groups[def.id], tg=g.target;
  if(!tg) continue;
  const proj=[], perp=[];
  for(let i=0;i<h.n;i++){ if(h.paddock[i]||h.group[i]!==def.id)continue;
    const dx=h.x[i]-tg.x, dy=h.y[i]-tg.y;
    proj.push(dx*tg.dirX + dy*tg.dirY);
    perp.push(-dx*tg.dirY + dy*tg.dirX);
  }
  if(!proj.length) { console.log(def.name,'EMPTY'); continue; }
  proj.sort((a,b)=>a-b); perp.sort((a,b)=>a-b);
  const q=(arr,p)=>arr[Math.min(arr.length-1,Math.floor(arr.length*p))].toFixed(0);
  console.log(def.name.padEnd(4),'n',String(proj.length).padStart(3),
    'proj', q(proj,0.1).padStart(5), q(proj,0.5).padStart(5), q(perp?proj:proj,0.9).padStart(5),
    '| perp', q(perp,0.1).padStart(4), q(perp,0.5).padStart(4), q(perp,0.9).padStart(4));
}
