import { World } from '../src/world.js';
import { Herd, P } from '../src/herd.js';
const DT=1/30, PX=3500, PY=2380, PR=118;
function rngFrom(s){ let a=s; return ()=>{ a=(a*16807)%2147483647; return (a-1)/2147483646; }; }
const counts = process.argv[2] ? [Number(process.argv[2])] : [120,150,180,210];
const stams = [0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9];
for (const count of counts) {
  const row = [];
  for (const sv of stams) {
    const w=new World(); w.build(0.5);
    const h=new Herd(w,3000); h.useSeed(77); h.setSeason(0.5); h.setPaddockFence(PX,PY,PR);
    h.addGroup(4,{});
    const r=rngFrom(5);
    for(let k=0;k<count;k++){ const a=r()*Math.PI*2, rr=Math.sqrt(r())*PR*0.92;
      h.add(PX+Math.cos(a)*rr, PY+Math.sin(a)*rr, 4, sv, {paddock:true}); }
    h.assignSeniority(true);
    for(let i=0;i<8/DT;i++) h.step(DT);
    const e0=h.stampedes; let pSum=0,nn=0;
    for(let i=0;i<10/DT;i++){ h.step(DT); if(i%6===0){ pSum+=h.paddockStats().pressure; nn++; } }
    const ps=h.paddockStats();
    row.push(`s${sv.toFixed(1)}:p${(pSum/nn).toFixed(2)}/t${(P.tolBase+P.tolGain*sv).toFixed(2)}:ev${h.stampedes-e0}/now${ps.stampeding}`);
  }
  console.log(`n=${count}  ` + row.join('  '));
}
