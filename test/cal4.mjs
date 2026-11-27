import { World } from '../src/world.js';
import { Herd, P } from '../src/herd.js';
const DT=1/30, PX=3520, PY=2360, PR=122;
function trial(count, sv) {
  const w=new World(); w.build(0.5);
  const h=new Herd(w,3000); h.useSeed(77); h.setSeason(0.5); h.setPaddockFence(PX,PY,PR);
  h.addGroup(9,{});
  let s=5; const r=()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};
  for(let k=0;k<count;k++){const a=r()*Math.PI*2, rr=Math.sqrt(r())*PR*0.92;
    h.add(PX+Math.cos(a)*rr,PY+Math.sin(a)*rr,9,sv,{paddock:true});}
  h.assignSeniority(true);
  for(let i=0;i<15*30;i++) h.step(DT);
  let sf=0,n=0,ps=0,mx=0;
  for(let i=0;i<10*30;i++){ h.step(DT); if(i%6===0){ const q=h.paddockStats(); sf+=q.stampeding/count; ps+=q.pressure; n++; } if(h.stampedes>mx) mx=h.stampedes; }
  return { stamp: sf/n, press: ps/n };
}
const stams=[0.40,0.45,0.48,0.50,0.52,0.55,0.58,0.62];
for (const count of [170,200]) {
  const row = stams.map(sv => { const t=trial(count,sv); return `${sv.toFixed(2)}:${(t.stamp*100).toFixed(0).padStart(3)}% p${t.press.toFixed(2)}`; });
  console.log(`n=${count} ` + row.join(' | '));
}
