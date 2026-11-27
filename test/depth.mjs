import { World } from '../src/world.js';
import { Herd, P } from '../src/herd.js';
const DT = 1/30;
const w = new World(); w.build(0.5);
const h = new Herd(w, 4000); h.setSeason(0.5);
h.addGroup(0, { rallyX: 1500, rallyY: 1400, rallyR: 600 });
let s = 5; const rnd = () => { s = (s*16807)%2147483647; return (s-1)/2147483646; };
for (let i=0;i<400;i++){ const a=rnd()*Math.PI*2, r=Math.sqrt(rnd())*240; h.add(1500+Math.cos(a)*r,1400+Math.sin(a)*r,0,0.45+rnd()*0.4); }
h.alpha[0] = 0;
for (let i=0;i<400;i++){ h.stam[i]=0.6; h.updateWarn(i); }
for (let i=0;i<16/DT;i++) h.step(DT);
h.computeStats();
console.log('maxD', h.stats.maxDepth, 'roots', h.stats.roots, 'following', h.stats.following);
// follower count histogram
const fc = {}; for (let i=0;i<h.n;i++){ const f=h.follow[i]; const k=f<0?'none':'has'; fc[k]=(fc[k]||0)+1; }
console.log(fc);
// top followers
const counts = new Map();
for (let i=0;i<h.n;i++){ const f=h.follow[i]; if(f>=0) counts.set(f,(counts.get(f)||0)+1); }
const top = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
console.log('top follower counts', top, 'capacity', P.capacity);
// walk a chain
let i=0; const path=[]; let guard=0;
// find deepest
let bestI=0; for(let k=0;k<h.n;k++){ let d=0,j=k; while(j>=0&&j<h.n&&guard++<2000){j=h.follow[j];d++;} if(d>0){} }
// measure longest chain properly
function chainLen(i){ let d=0,j=i,g=0; while(j>=0&&j<h.n&&g++<5000){j=h.follow[j];d++;} return d; }
let mx=0,mi=0; for(let k=0;k<h.n;k++){ const d=chainLen(k); if(d>mx){mx=d;mi=k;} }
console.log('longest chain from', mi, 'len', mx);
let j=mi, g=0; const chain=[];
while(j>=0&&j<h.n&&g++<40){ chain.push([j, h.stam[j].toFixed(3), h.fcount[j]]); j=h.follow[j]; }
console.log(chain.slice(0,20));
