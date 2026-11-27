import { World } from '../src/world.js';
import { Herd, P } from '../src/herd.js';
const DT=1/30, PX=3520, PY=2360, PR=122;
const counts = [140,170,200,230];
const stams = [0.30,0.35,0.40,0.45,0.50,0.55,0.60,0.70,0.85];
for (const count of counts) {
  const row=[];
  for (const sv of stams) {
    const w=new World(); w.build(0.5);
    const h=new Herd(w,3000); h.useSeed(77); h.setSeason(0.5); h.setPaddockFence(PX,PY,PR);
    h.addGroup(9,{});
    let s=5; const r=()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};
    for(let k=0;k<count;k++){const a=r()*Math.PI*2, rr=Math.sqrt(r())*PR*0.92;
      h.add(PX+Math.cos(a)*rr,PY+Math.sin(a)*rr,9,sv,{paddock:true});}
    h.assignSeniority(true);
    for(let i=0;i<15*30;i++) h.step(DT);       // settle
    let stampFrac=0, n=0, pSum=0;
    for(let i=0;i<10*30;i++){ h.step(DT); if(i%6===0){ const ps=h.paddockStats(); stampFrac+=ps.stampeding/count; pSum+=ps.pressure; n++; } }
    row.push(`s${sv.toFixed(2)}:${(stampFrac/n*100).toFixed(0).padStart(3)}%`);
  }
  console.log(`n=${count} tol@0.5=${(P.tolBase+P.tolGain*0.5).toFixed(2)}  ` + row.join(' '));
}
