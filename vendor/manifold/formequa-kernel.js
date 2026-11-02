/* FORMEQUA adapter. Manifold runtime is separately licensed in LICENSE.txt. */
import Module from './manifold.js';
let ready;
export function initialize(){
  if(!ready)ready=Module({locateFile:()=>new URL('./manifold.wasm',import.meta.url).href}).then(wasm=>{wasm.setup();return wasm;});
  return ready;
}
export async function buildSolids(items){
  if(!Array.isArray(items)||items.length>72)throw new Error('INVALID_SOLID_BATCH');
  const {CrossSection}=await initialize(),results=[];
  for(const item of items){
    const h=item.heightM,rings=item.contours;
    if(typeof item.key!=='string'||!Number.isFinite(h)||h<=0||h>300||!Array.isArray(rings)||!rings.length||rings.length>4||
       rings.some(r=>!Array.isArray(r)||r.length<3||r.length>64||r.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>2000))))throw new Error('INVALID_SOLID');
    const owned=[];
    try{
      const section=new CrossSection(rings.map(r=>r.map(([x,z])=>[x,-z])),'EvenOdd');owned.push(section);
      let solid=section.extrude(h);owned.push(solid);
      if(item.sloped){
        const xs=rings[0].map(p=>p[0]),w=Math.max(...xs)-Math.min(...xs);
        if(w<=0)throw new Error('INVALID_CROWN');
        const a=.9*h/w,n=Math.hypot(a,1),b=.1*h-a*Math.min(...xs);
        solid=solid.trimByPlane([a/n,0,-1/n],-b/n);owned.push(solid);
      }
      if(solid.status()!=='NoError'||solid.isEmpty())throw new Error('SOLID_GENERATION_FAILED');
      const mesh=solid.getMesh(),stride=mesh.numProp||3;
      const positions=new Float32Array(mesh.vertProperties.length/stride*3);
      for(let i=0,j=0;i<mesh.vertProperties.length;i+=stride,j+=3){
        positions[j]=mesh.vertProperties[i];positions[j+1]=mesh.vertProperties[i+2]-h/2;positions[j+2]=-mesh.vertProperties[i+1];
      }
      results.push({key:item.key,positions,indices:new Uint32Array(mesh.triVerts)});
    }finally{for(let i=owned.length-1;i>=0;i--)owned[i].delete();}
  }
  return results;
}
