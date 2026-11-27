import { makeHerd, retargetGroups, GROUPS } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World(); w.build(0.95);
const h=makeHerd(w,{pop:900, season:0.95, seed:13});
retargetGroups(h, 0.95);
for(let i=0;i<150*30;i++) h.step(1/30);
// measure median distance from an animal to its guide, vs personal radius
let gd=[], foll=0;
for(let i=0;i<h.n;i++){ const f=h.guide[i]; if(f<0)continue; foll++; gd.push(Math.hypot(h.x[i]-h.x[f],h.y[i]-h.y[f])); }
gd.sort((a,b)=>a-b);
const q=(p)=>gd[Math.floor(gd.length*p)].toFixed(1);
console.log('followers',foll,'/',h.n,'guideDist p10',q(0.1),'p50',q(0.5),'p90',q(0.9));
// longest chain
let mx=0; for(let i=0;i<h.n;i++){ let d=0,j=i,g=0; while(j>=0&&g++<500){j=h.guide[j];d++;} if(d>mx)mx=d; }
console.log('max chain', mx, 'mean chain', (()=>{let s=0;for(let i=0;i<h.n;i++){let d=0,j=i,g=0;while(j>=0&&g++<500){j=h.guide[j];d++;}s+=d;}return (s/h.n).toFixed(2);})());
console.log('personal', h.personal[0].toFixed(1), 'R', h.R[0].toFixed(0));
