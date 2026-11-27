import { makeHerd, retargetGroups, GROUPS } from '../src/scenario.js';
import { World } from '../src/world.js';
const w=new World(); w.build(0.95);
const h=makeHerd(w,{pop:900, season:0.95, seed:13});
retargetGroups(h, 0.95);
for(let i=0;i<150*30;i++) h.step(1/30);
h.computeStats();
let foll=0, stamp=0;
for(let i=0;i<h.n;i++){ if(h.guide[i]>=0) foll++; if(h.state[i]===4) stamp++; }
console.log('followers', foll, '/', h.n, 'stampeding', stamp, 'stam', h.stats.meanStam.toFixed(2), 'R', h.stats.meanR.toFixed(0));
// NN histogram
const nn=[];
for(let i=0;i<h.n;i+=3){ if(h.paddock[i])continue; let b=1e9; for(let j=0;j<h.n;j++){if(i===j||h.paddock[j])continue; const d=Math.hypot(h.x[i]-h.x[j],h.y[i]-h.y[j]); if(d<b)b=d;} nn.push(b); }
nn.sort((a,b)=>a-b);
const q=(p)=>nn[Math.floor(nn.length*p)].toFixed(1);
console.log('NN p10',q(0.1),'p50',q(0.5),'p90',q(0.9),'max',nn[nn.length-1].toFixed(1));
console.log('mean personal', (h.personal.slice(0,h.n).reduce((a,b)=>a+b,0)/h.n).toFixed(1));
// pile count (groups of > 5 animals within 25 units)
let close=0; for(let i=0;i<h.n;i+=3){ let c=0; for(let j=0;j<h.n;j++){if(i===j)continue; if(Math.hypot(h.x[i]-h.x[j],h.y[i]-h.y[j])<25) c++;} if(c>4) close++; }
console.log('crowded fraction', (close/(h.n/3)).toFixed(2));
