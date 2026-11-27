import { World } from '../src/world.js';
import { Herd, P } from '../src/herd.js';
const DT=1/30, PX=3500, PY=2380, PR=118;
function rngFrom(s){ let a=s; return ()=>{ a=(a*16807)%2147483647; return (a-1)/2147483646; }; }
for (const count of [150,170,190,210,230]) {
  const row=[];
  for (const sv of [0.35,0.45,0.55,0.65,0.75]) {
    const w=new World(); w.build(0.5);
    const h=new Herd(w,3000); h.useSeed(77); h.setSeason(0.5); h.setPaddockFence(PX,PY,PR);
    h.addGroup(4,{});
    const r=rngFrom(5);
    for(let k=0;k<count;k++){ const a=r()*Math.PI*2, rr=Math.sqrt(r())*PR*0.92;
      h.add(PX+Math.cos(a)*rr, PY+Math.sin(a)*rr, 4, sv, {paddock:true}); }
    h.assignSeniority(true);
    for(let i=0;i<8/DT;i++) h.step(DT);
    const e0=h.stampedes; let pSum=0,nn=0;
    for(let i=0;i<12/DT;i++){ h.step(DT); if(i%6===0){ pSum+=h.paddockStats().pressure; nn++; } }
    row.push(`s${sv.toFixed(2)} p${(pSum/nn).toFixed(3)} ev${String(h.stampedes-e0).padStart(3)}`);
  }
  console.log(`n=${count}  ` + row.join(' | '));
}
